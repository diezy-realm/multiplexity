use crate::machines::{text, vm};
use crate::{ApiResult, AppError, AppState, User};
use axum::{
    Extension, Json, Router,
    extract::{Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures_util::TryStreamExt;
use serde_json::{Value, json};
use sqlx::{
    Column, Row, TypeInfo, ValueRef,
    mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlRow},
    postgres::{PgConnectOptions, PgPoolOptions, PgRow},
};
use std::{
    collections::HashMap,
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};

mod tunnel;

#[derive(Clone)]
enum Pool {
    Mysql(sqlx::MySqlPool),
    Postgres(sqlx::PgPool),
}
struct Active {
    pool: Pool,
    _tunnel: Option<tunnel::Tunnel>,
}
type Connections = tokio::sync::Mutex<HashMap<String, Arc<Active>>>;
fn connections() -> &'static Connections {
    static CONNECTIONS: OnceLock<Connections> = OnceLock::new();
    CONNECTIONS.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()))
}
pub async fn shutdown(state: &AppState) {
    let prefix = format!("{}:", state.data_dir.display());
    let items: Vec<_> = {
        let mut map = connections().lock().await;
        let keys: Vec<_> = map
            .keys()
            .filter(|key| key.starts_with(&prefix))
            .cloned()
            .collect();
        keys.into_iter()
            .filter_map(|key| map.remove(&key))
            .collect()
    };
    for item in items {
        match &item.pool {
            Pool::Mysql(pool) => pool.close().await,
            Pool::Postgres(pool) => pool.close().await,
        }
    }
}
fn key(state: &AppState, user: &str, id: &str, database: &str) -> String {
    format!("{}:{user}:{id}:{database}", state.data_dir.display())
}
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/databases", get(list).post(create))
        .route(
            "/api/databases/{id}",
            get(detail).put(update).delete(remove),
        )
        .route("/api/databases/{id}/connect", post(connect))
        .route("/api/databases/{id}/disconnect", post(disconnect))
        .route("/api/databases/{id}/status", get(status))
        .route("/api/databases/{id}/query", post(query))
        .route("/api/databases/{id}/history", get(history))
        .route("/api/databases/{id}/export", post(export))
        .route("/api/databases/{id}/schema", get(schema))
        .route("/api/databases/{id}/schema/{database}", get(tables))
        .route(
            "/api/databases/{id}/schema/{database}/{table}",
            get(columns),
        )
}
fn config(state: &AppState, user: &str, id: &str) -> Result<Value, AppError> {
    state.db.one("SELECT dc.*,v.label AS vm_label FROM database_connections dc LEFT JOIN vms v ON v.id=dc.vm_id AND v.user_id=dc.user_id WHERE dc.id=? AND dc.user_id=?",&[json!(id),json!(user)])?.ok_or_else(||AppError::not_found("Database connection not found"))
}
fn public(row: Value) -> Value {
    json!({"id":row["id"],"vmId":row["vm_id"],"vmLabel":row["vm_label"],"dbType":row["db_type"],"host":row["host"],"port":row["port"],"username":row["db_username"],"label":row["label"],"status":"disconnected","createdAt":row["created_at"],"updatedAt":row["updated_at"]})
}
async fn list(State(state): State<AppState>, Extension(user): Extension<User>) -> ApiResult {
    Ok(Json(json!(state.db.query("SELECT dc.*,v.label AS vm_label FROM database_connections dc LEFT JOIN vms v ON v.id=dc.vm_id AND v.user_id=dc.user_id WHERE dc.user_id=? ORDER BY dc.created_at DESC",&[json!(user.id)])?.into_iter().map(public).collect::<Vec<_>>())))
}
async fn detail(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    Ok(Json(public(config(&state, &user.id, &id)?)))
}
fn nonempty(value: &Value, key: &str) -> Result<String, AppError> {
    let x = text(value, key).trim();
    if x.is_empty() || x.len() > 4096 || x.chars().any(char::is_control) {
        Err(AppError::bad_request(format!("{key} is required")))
    } else {
        Ok(x.to_owned())
    }
}
fn validate_type(value: &str) -> Result<(), AppError> {
    if ["mysql", "mariadb", "postgresql"].contains(&value) {
        Ok(())
    } else {
        Err(AppError::bad_request("Invalid database type"))
    }
}
async fn create(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), AppError> {
    let kind = nonempty(&body, "dbType")?;
    validate_type(&kind)?;
    let username = nonempty(&body, "username")?;
    let password = body["password"]
        .as_str()
        .ok_or_else(|| AppError::bad_request("password is required"))?;
    let host = if text(&body, "host").is_empty() {
        "localhost"
    } else {
        text(&body, "host")
    };
    let port = super::machines::port(
        body.get("port"),
        if kind == "postgresql" { 5432 } else { 3306 },
    )?;
    let vm_id = body
        .get("vmId")
        .filter(|x| x.as_str().is_some_and(|s| !s.is_empty()))
        .cloned()
        .unwrap_or(Value::Null);
    if let Some(id) = vm_id.as_str() {
        vm(&state, &user.id, id)?;
    }
    let secret = state.db.encrypt(password)?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    state.db.execute("INSERT INTO database_connections(id,user_id,vm_id,db_type,host,port,db_username,encrypted_password,encryption_iv,encryption_auth_tag,label) VALUES(?,?,?,?,?,?,?,?,?,?,?)",&[json!(id),json!(user.id),vm_id,json!(kind),json!(host),json!(port),json!(username),json!(secret.ciphertext),json!(secret.iv),json!(secret.auth_tag),body.get("label").cloned().unwrap_or(Value::Null)])?;
    Ok((
        StatusCode::CREATED,
        Json(public(config(&state, &user.id, &id)?)),
    ))
}
async fn update(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    config(&state, &user.id, &id)?;
    let mut columns = Vec::new();
    let mut values = Vec::new();
    for (key, column) in [
        ("dbType", "db_type"),
        ("host", "host"),
        ("username", "db_username"),
        ("label", "label"),
    ] {
        if body.get(key).is_some() {
            let value = nonempty(&body, key)?;
            if key == "dbType" {
                validate_type(&value)?;
            }
            columns.push(format!("{column}=?"));
            values.push(json!(value));
        }
    }
    if body.get("port").is_some() {
        values.push(json!(super::machines::port(body.get("port"), 3306)?));
        columns.push("port=?".into());
    }
    if body.get("vmId").is_some() {
        let value = body["vmId"].clone();
        if let Some(id) = value.as_str() {
            vm(&state, &user.id, id)?;
        } else if !value.is_null() {
            return Err(AppError::bad_request("Invalid VM"));
        }
        columns.push("vm_id=?".into());
        values.push(value);
    }
    if !text(&body, "password").is_empty() {
        let secret = state.db.encrypt(text(&body, "password"))?;
        columns.extend([
            "encrypted_password=?".into(),
            "encryption_iv=?".into(),
            "encryption_auth_tag=?".into(),
        ]);
        values.extend([
            json!(secret.ciphertext),
            json!(secret.iv),
            json!(secret.auth_tag),
        ]);
    }
    if columns.is_empty() {
        return Err(AppError::bad_request("No fields to update"));
    }
    values.extend([json!(id), json!(user.id)]);
    state.db.execute(&format!("UPDATE database_connections SET {},updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?",columns.join(",")),&values)?;
    close_pools(&state, &user.id, &id).await;
    Ok(Json(public(config(&state, &user.id, &id)?)))
}
async fn close_pools(state: &AppState, user: &str, id: &str) {
    let prefix = key(state, user, id, "");
    let old: Vec<_> = {
        let mut map = connections().lock().await;
        let keys: Vec<_> = map
            .keys()
            .filter(|x| x.starts_with(&prefix))
            .cloned()
            .collect();
        keys.into_iter().filter_map(|x| map.remove(&x)).collect()
    };
    for item in old {
        match &item.pool {
            Pool::Mysql(pool) => pool.close().await,
            Pool::Postgres(pool) => pool.close().await,
        }
    }
}
async fn remove(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    config(&state, &user.id, &id)?;
    close_pools(&state, &user.id, &id).await;
    state.db.execute(
        "DELETE FROM database_connections WHERE id=? AND user_id=?",
        &[json!(id), json!(user.id)],
    )?;
    Ok(Json(json!({"success":true})))
}
async fn active(
    state: &AppState,
    user: &str,
    id: &str,
    database: &str,
) -> Result<Arc<Active>, AppError> {
    let row = config(state, user, id)?;
    let cache_key = key(state, user, id, database);
    if let Some(active) = connections().lock().await.get(&cache_key).cloned() {
        return Ok(active);
    }
    let password = state.db.decrypt(
        text(&row, "encrypted_password"),
        text(&row, "encryption_iv"),
        text(&row, "encryption_auth_tag"),
    )?;
    let port = row["port"].as_u64().unwrap_or(3306) as u16;
    let tunnel = if let Some(vm_id) = row["vm_id"].as_str() {
        Some(tunnel::start(state, user, vm_id, text(&row, "host"), port).await?)
    } else {
        None
    };
    let (host, port) = if let Some(tunnel) = &tunnel {
        ("127.0.0.1", tunnel.port)
    } else {
        (text(&row, "host"), port)
    };
    let pool = if text(&row, "db_type") == "postgresql" {
        let mut options = PgConnectOptions::new()
            .host(host)
            .port(port)
            .username(text(&row, "db_username"))
            .password(&password);
        options = options.database(if database.is_empty() {
            "postgres"
        } else {
            database
        });
        Pool::Postgres(
            PgPoolOptions::new()
                .max_connections(3)
                .acquire_timeout(Duration::from_secs(15))
                .connect_with(options)
                .await
                .map_err(db_error)?,
        )
    } else {
        let mut options = MySqlConnectOptions::new()
            .host(host)
            .port(port)
            .username(text(&row, "db_username"))
            .password(&password);
        if !database.is_empty() {
            options = options.database(database);
        }
        Pool::Mysql(
            MySqlPoolOptions::new()
                .max_connections(3)
                .acquire_timeout(Duration::from_secs(15))
                .connect_with(options)
                .await
                .map_err(db_error)?,
        )
    };
    let result = Arc::new(Active {
        pool,
        _tunnel: tunnel,
    });
    connections().lock().await.insert(cache_key, result.clone());
    Ok(result)
}
fn db_error(error: sqlx::Error) -> AppError {
    match error {
        sqlx::Error::Database(error) => AppError::internal(error.message().to_owned()),
        _ => AppError::internal("Database connection, query or timeout failure"),
    }
}
async fn connect(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    active(&state, &user.id, &id, "").await?;
    Ok(Json(
        json!({"id":id,"status":"connected","message":"Database connection established successfully"}),
    ))
}
async fn disconnect(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    config(&state, &user.id, &id)?;
    close_pools(&state, &user.id, &id).await;
    Ok(Json(
        json!({"id":id,"status":"disconnected","success":true}),
    ))
}
async fn status(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    config(&state, &user.id, &id)?;
    let active = connections()
        .lock()
        .await
        .get(&key(&state, &user.id, &id, ""))
        .cloned();
    let status = if let Some(active) = active {
        let ok = match &active.pool {
            Pool::Mysql(pool) => sqlx::query("SELECT 1").execute(pool).await.is_ok(),
            Pool::Postgres(pool) => sqlx::query("SELECT 1").execute(pool).await.is_ok(),
        };
        if ok { "connected" } else { "unreachable" }
    } else {
        "disconnected"
    };
    Ok(Json(json!({"id":id,"status":status})))
}
fn single_statement(sql: &str) -> Result<(), AppError> {
    if sql.trim().is_empty() {
        return Err(AppError::bad_request("SQL query is required"));
    }
    if sql.len() > 1_000_000 {
        return Err(AppError::bad_request("SQL exceeds 1 MB"));
    }
    if let Some((_, rest)) = sql.split_once(';')
        && !rest.trim().is_empty()
    {
        return Err(AppError::bad_request(
            "Multiple statements are not allowed in a single execution",
        ));
    }
    Ok(())
}
async fn execute_query(active: &Active, sql: &str) -> Result<Value, AppError> {
    single_statement(sql)?;
    let start = Instant::now();
    let mut columns = Vec::<String>::new();
    let mut rows = Vec::new();
    let mut affected = 0u64;
    match &active.pool {
        Pool::Mysql(pool) => {
            let mut stream = sqlx::raw_sql(sqlx::AssertSqlSafe(sql)).fetch_many(pool);
            while let Some(item) = stream.try_next().await.map_err(db_error)? {
                match item {
                    sqlx::Either::Left(result) => affected += result.rows_affected(),
                    sqlx::Either::Right(row) => {
                        if columns.is_empty() {
                            columns = row.columns().iter().map(|x| x.name().to_owned()).collect();
                        }
                        if rows.len() < 1001 {
                            rows.push(mysql_row(&row)?);
                        } else {
                            break;
                        }
                    }
                }
            }
        }
        Pool::Postgres(pool) => {
            let mut stream = sqlx::raw_sql(sqlx::AssertSqlSafe(sql)).fetch_many(pool);
            while let Some(item) = stream.try_next().await.map_err(db_error)? {
                match item {
                    sqlx::Either::Left(result) => affected += result.rows_affected(),
                    sqlx::Either::Right(row) => {
                        if columns.is_empty() {
                            columns = row.columns().iter().map(|x| x.name().to_owned()).collect();
                        }
                        if rows.len() < 1001 {
                            rows.push(pg_row(&row)?);
                        } else {
                            break;
                        }
                    }
                }
            }
        }
    }
    let truncated = rows.len() > 1000;
    rows.truncate(1000);
    Ok(
        json!({"columns":columns,"rowCount":rows.len(),"rows":rows,"affectedRows":affected,"truncated":truncated,"executionTimeMs":start.elapsed().as_millis() as u64}),
    )
}
async fn query(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    config(&state, &user.id, &id)?;
    let sql = body["sql"]
        .as_str()
        .ok_or_else(|| AppError::bad_request("SQL query is required"))?;
    single_statement(sql)?;
    let database = text(&body, "database");
    let started = Instant::now();
    let result = async {
        let pool = active(&state, &user.id, &id, database).await?;
        tokio::time::timeout(Duration::from_secs(30), execute_query(&pool, sql))
            .await
            .map_err(|_| AppError::internal("Query timed out after 30 seconds"))?
    }
    .await;
    let (status, error, count) = match &result {
        Ok(value) => ("success", Value::Null, value["rowCount"].clone()),
        Err(_) => ("error", json!("Query failed"), Value::Null),
    };
    state.db.execute("INSERT INTO query_history(connection_id,database_name,query_text,status,error_message,execution_time_ms,row_count) VALUES(?,?,?,?,?,?,?)",&[json!(id),json!(database),json!(sql),json!(status),error,json!(started.elapsed().as_millis()as u64),count])?;
    result.map(Json)
}
fn mysql_row(row: &MySqlRow) -> Result<Value, AppError> {
    let mut result = serde_json::Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        let raw = row.try_get_raw(index).map_err(db_error)?;
        let value = if raw.is_null() {
            Value::Null
        } else {
            match column.type_info().name() {
                "BOOLEAN" => json!(row.try_get::<bool, _>(index).map_err(db_error)?),
                "TINYINT" | "SMALLINT" | "INT" | "MEDIUMINT" | "BIGINT" => {
                    json!(row.try_get::<i64, _>(index).map_err(db_error)?)
                }
                "TINYINT UNSIGNED" | "SMALLINT UNSIGNED" | "INT UNSIGNED"
                | "MEDIUMINT UNSIGNED" | "BIGINT UNSIGNED" => {
                    json!(row.try_get::<u64, _>(index).map_err(db_error)?)
                }
                "FLOAT" | "DOUBLE" => json!(row.try_get::<f64, _>(index).map_err(db_error)?),
                "DECIMAL" => json!(
                    row.try_get::<sqlx::types::BigDecimal, _>(index)
                        .map_err(db_error)?
                        .to_string()
                ),
                "JSON" => row.try_get::<Value, _>(index).map_err(db_error)?,
                "DATE" => json!(
                    row.try_get::<chrono::NaiveDate, _>(index)
                        .map_err(db_error)?
                        .to_string()
                ),
                "DATETIME" | "TIMESTAMP" => json!(
                    row.try_get::<chrono::NaiveDateTime, _>(index)
                        .map_err(db_error)?
                        .to_string()
                ),
                "TIME" => json!(
                    row.try_get::<chrono::NaiveTime, _>(index)
                        .map_err(db_error)?
                        .to_string()
                ),
                _ => {
                    if let Ok(value) = row.try_get::<String, _>(index) {
                        json!(value)
                    } else if let Ok(value) = row.try_get::<Vec<u8>, _>(index) {
                        use base64::Engine;
                        json!(base64::engine::general_purpose::STANDARD.encode(value))
                    } else {
                        return Err(AppError::internal("Unsupported database column type"));
                    }
                }
            }
        };
        result.insert(column.name().into(), value);
    }
    Ok(Value::Object(result))
}
fn pg_row(row: &PgRow) -> Result<Value, AppError> {
    let mut result = serde_json::Map::new();
    for (index, column) in row.columns().iter().enumerate() {
        let raw = row.try_get_raw(index).map_err(db_error)?;
        let value = if raw.is_null() {
            Value::Null
        } else {
            match column.type_info().name() {
                "BOOL" => json!(row.try_get::<bool, _>(index).map_err(db_error)?),
                "INT2" => json!(row.try_get::<i16, _>(index).map_err(db_error)?),
                "INT4" => json!(row.try_get::<i32, _>(index).map_err(db_error)?),
                "INT8" => json!(row.try_get::<i64, _>(index).map_err(db_error)?),
                "FLOAT4" => json!(row.try_get::<f32, _>(index).map_err(db_error)?),
                "FLOAT8" => json!(row.try_get::<f64, _>(index).map_err(db_error)?),
                "NUMERIC" => json!(
                    row.try_get::<sqlx::types::BigDecimal, _>(index)
                        .map_err(db_error)?
                        .to_string()
                ),
                "JSON" | "JSONB" => row.try_get::<Value, _>(index).map_err(db_error)?,
                "DATE" => json!(
                    row.try_get::<chrono::NaiveDate, _>(index)
                        .map_err(db_error)?
                        .to_string()
                ),
                "TIMESTAMP" => json!(
                    row.try_get::<chrono::NaiveDateTime, _>(index)
                        .map_err(db_error)?
                        .to_string()
                ),
                "TIMESTAMPTZ" => json!(
                    row.try_get::<chrono::DateTime<chrono::Utc>, _>(index)
                        .map_err(db_error)?
                        .to_rfc3339()
                ),
                "UUID" => json!(
                    row.try_get::<uuid::Uuid, _>(index)
                        .map_err(db_error)?
                        .to_string()
                ),
                "BYTEA" => {
                    use base64::Engine;
                    json!(
                        base64::engine::general_purpose::STANDARD
                            .encode(row.try_get::<Vec<u8>, _>(index).map_err(db_error)?)
                    )
                }
                _ => json!(
                    row.try_get::<String, _>(index)
                        .map_err(|_| AppError::internal("Unsupported PostgreSQL column type"))?
                ),
            }
        };
        result.insert(column.name().into(), value);
    }
    Ok(Value::Object(result))
}
async fn schema(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
) -> ApiResult {
    let active = active(&state, &user.id, &id, "").await?;
    let sql = match &active.pool {
        Pool::Mysql(_) => "SHOW DATABASES",
        Pool::Postgres(_) => "SELECT datname FROM pg_database WHERE datistemplate=false",
    };
    let result = execute_query(&active, sql).await?;
    Ok(Json(json!({"databases":first_values(&result)})))
}
fn first_values(result: &Value) -> Vec<Value> {
    result["rows"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|row| row.as_object()?.values().next().cloned())
                .collect()
        })
        .unwrap_or_default()
}
fn identifier(value: &str) -> Result<(), AppError> {
    if value.is_empty() || value.len() > 255 || value.chars().any(char::is_control) {
        Err(AppError::bad_request("Invalid database identifier"))
    } else {
        Ok(())
    }
}
fn mysql_identifier(value: &str) -> String {
    format!("`{}`", value.replace('`', "``"))
}
async fn tables(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path((id, database)): Path<(String, String)>,
) -> ApiResult {
    identifier(&database)?;
    let active = active(&state, &user.id, &id, &database).await?;
    let sql = match &active.pool {
        Pool::Mysql(_) => format!("SHOW TABLES FROM {}", mysql_identifier(&database)),
        Pool::Postgres(_) => {
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename".into()
        }
    };
    let result = execute_query(&active, &sql).await?;
    Ok(Json(
        json!({"database":database,"tables":first_values(&result)}),
    ))
}
async fn columns(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path((id, database, table)): Path<(String, String, String)>,
) -> ApiResult {
    identifier(&database)?;
    identifier(&table)?;
    let active = active(&state, &user.id, &id, &database).await?;
    let columns = match &active.pool {
        Pool::Mysql(_) => {
            let result = execute_query(
                &active,
                &format!(
                    "SHOW COLUMNS FROM {} FROM {}",
                    mysql_identifier(&table),
                    mysql_identifier(&database)
                ),
            )
            .await?;
            result["rows"].as_array().into_iter().flatten().map(|row|json!({"name":row["Field"],"type":row["Type"],"nullable":row["Null"]=="YES","primaryKey":row["Key"]=="PRI","defaultValue":row["Default"]})).collect::<Vec<_>>()
        }
        Pool::Postgres(pool) => {
            let rows=sqlx::query("SELECT c.column_name,c.data_type,c.is_nullable,c.column_default, EXISTS(SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage k ON k.constraint_name=tc.constraint_name AND k.table_schema=tc.table_schema WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public' AND tc.table_name=c.table_name AND k.column_name=c.column_name) AS primary_key FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=$1 ORDER BY c.ordinal_position").bind(&table).fetch_all(pool).await.map_err(db_error)?;
            rows.iter().map(|row|json!({"name":row.get::<String,_>("column_name"),"type":row.get::<String,_>("data_type"),"nullable":row.get::<String,_>("is_nullable")=="YES","primaryKey":row.get::<bool,_>("primary_key"),"defaultValue":row.get::<Option<String>,_>("column_default")})).collect()
        }
    };
    Ok(Json(
        json!({"database":database,"table":table,"columns":columns}),
    ))
}
async fn history(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    Query(_query): Query<HashMap<String, String>>,
) -> ApiResult {
    config(&state, &user.id, &id)?;
    state.db.execute("DELETE FROM query_history WHERE connection_id=? AND id NOT IN(SELECT id FROM query_history WHERE connection_id=? ORDER BY executed_at DESC LIMIT 100)",&[json!(id),json!(id)])?;
    let rows = state.db.query(
        "SELECT * FROM query_history WHERE connection_id=? ORDER BY executed_at DESC LIMIT 100",
        &[json!(id)],
    )?;
    Ok(Json(json!(rows.into_iter().map(|row|json!({"id":row["id"],"queryText":row["query_text"],"databaseName":row["database_name"],"status":row["status"],"errorMessage":row["error_message"],"executionTimeMs":row["execution_time_ms"],"rowCount":row["row_count"],"executedAt":row["executed_at"]})).collect::<Vec<_>>())))
}
async fn export(
    State(state): State<AppState>,
    Extension(user): Extension<User>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Response, AppError> {
    config(&state, &user.id, &id)?;
    let columns = body["columns"]
        .as_array()
        .filter(|x| !x.is_empty() && x.iter().all(Value::is_string))
        .ok_or_else(|| AppError::bad_request("Columns are required"))?;
    let rows = body["rows"]
        .as_array()
        .ok_or_else(|| AppError::bad_request("Rows are required"))?;
    let mut writer = csv::Writer::from_writer(Vec::new());
    writer
        .write_record(columns.iter().map(|x| x.as_str().unwrap_or("")))
        .map_err(|_| AppError::internal("CSV export failed"))?;
    for row in rows {
        writer
            .write_record(columns.iter().map(|column| {
                let value = &row[column.as_str().unwrap_or("")];
                match value {
                    Value::Null => String::new(),
                    Value::String(s) => s.clone(),
                    _ => value.to_string(),
                }
            }))
            .map_err(|_| AppError::internal("CSV export failed"))?;
    }
    let data = writer
        .into_inner()
        .map_err(|_| AppError::internal("CSV export failed"))?;
    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=export.csv",
            ),
        ],
        data,
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn statements_are_bounded() {
        assert!(single_statement("SELECT 1;").is_ok());
        assert!(single_statement("SELECT 1; DROP TABLE users").is_err());
        assert!(single_statement("").is_err());
    }
    #[test]
    fn identifiers_escape_embedded_backticks() {
        assert_eq!(mysql_identifier("a`b"), "`a``b`");
    }
}
