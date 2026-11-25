use crate::AppError;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce, aead::Aead};
use base64::{Engine, engine::general_purpose::STANDARD};
use rand::RngCore;
use rusqlite::{
    Connection, params_from_iter,
    types::{Value as SqlValue, ValueRef},
};
use serde_json::{Map, Value, json};
use std::{path::Path, sync::Mutex, time::Duration};

pub struct Store {
    connection: Mutex<Connection>,
    key: [u8; 32],
}
pub struct Encrypted {
    pub ciphertext: String,
    pub iv: String,
    pub auth_tag: String,
}
fn db_error(_: rusqlite::Error) -> AppError {
    AppError::internal("Local database operation failed")
}
fn io_error(_: std::io::Error) -> AppError {
    AppError::internal("Local storage operation failed")
}

impl Store {
    pub fn open(directory: &Path) -> Result<Self, AppError> {
        std::fs::create_dir_all(directory).map_err(io_error)?;
        if std::fs::symlink_metadata(directory)
            .map_err(io_error)?
            .file_type()
            .is_symlink()
        {
            return Err(AppError::bad_request("Data directory cannot be a symlink"));
        }
        let key = load_key(directory)?;
        Self::initialize(
            Connection::open(directory.join("multiplexity.db")).map_err(db_error)?,
            key,
        )
    }
    fn initialize(connection: Connection, key: [u8; 32]) -> Result<Self, AppError> {
        connection
            .busy_timeout(Duration::from_secs(5))
            .map_err(db_error)?;
        connection
            .execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(db_error)?;
        connection
            .execute_batch(include_str!("../../../src/lib/db/schema.sql"))
            .map_err(db_error)?;
        for (table, column, definition) in [
            ("users", "auth_version", "INTEGER NOT NULL DEFAULT 0"),
            ("ai_connections", "endpoint", "TEXT NOT NULL DEFAULT ''"),
            ("vms", "user_id", "TEXT NOT NULL DEFAULT ''"),
            (
                "database_connections",
                "user_id",
                "TEXT NOT NULL DEFAULT ''",
            ),
        ] {
            let mut query = connection
                .prepare(&format!("PRAGMA table_info('{table}')"))
                .map_err(db_error)?;
            let columns = query
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(db_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(db_error)?;
            if !columns.iter().any(|value| value == column) {
                connection
                    .execute_batch(&format!(
                        "ALTER TABLE {table} ADD COLUMN {column} {definition}"
                    ))
                    .map_err(db_error)?;
            }
        }
        connection.execute_batch("CREATE TABLE IF NOT EXISTS rust_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);CREATE INDEX IF NOT EXISTS rust_session_expiry ON rust_sessions(expires);").map_err(db_error)?;
        Ok(Self {
            connection: Mutex::new(connection),
            key,
        })
    }
    pub fn with_connection<T>(
        &self,
        operation: impl FnOnce(&mut Connection) -> Result<T, AppError>,
    ) -> Result<T, AppError> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| AppError::internal("Database lock unavailable"))?;
        operation(&mut connection)
    }
    pub fn query(&self, sql: &str, parameters: &[Value]) -> Result<Vec<Value>, AppError> {
        let values = parameters.iter().map(sql_value).collect::<Vec<_>>();
        self.with_connection(|connection| {
            let mut statement = connection.prepare(sql).map_err(db_error)?;
            let names = statement
                .column_names()
                .map(String::from)
                .collect::<Vec<_>>();
            let rows = statement
                .query_map(params_from_iter(values.iter()), |row| {
                    let mut object = Map::new();
                    for (index, name) in names.iter().enumerate() {
                        let value = match row.get_ref(index)? {
                            ValueRef::Null => Value::Null,
                            ValueRef::Integer(value) => json!(value),
                            ValueRef::Real(value) => json!(value),
                            ValueRef::Text(value) => json!(String::from_utf8_lossy(value)),
                            ValueRef::Blob(value) => json!(STANDARD.encode(value)),
                        };
                        object.insert(name.clone(), value);
                    }
                    Ok(Value::Object(object))
                })
                .map_err(db_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(db_error)?;
            Ok(rows)
        })
    }
    pub fn one(&self, sql: &str, parameters: &[Value]) -> Result<Option<Value>, AppError> {
        Ok(self.query(sql, parameters)?.into_iter().next())
    }
    pub fn execute(&self, sql: &str, parameters: &[Value]) -> Result<usize, AppError> {
        let values = parameters.iter().map(sql_value).collect::<Vec<_>>();
        self.with_connection(|connection| {
            connection
                .execute(sql, params_from_iter(values.iter()))
                .map_err(db_error)
        })
    }
    pub fn encrypt(&self, plaintext: &str) -> Result<Encrypted, AppError> {
        let cipher = Aes256Gcm::new_from_slice(&self.key)
            .map_err(|_| AppError::internal("Encryption unavailable"))?;
        let mut nonce = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce);
        let mut encrypted = cipher
            .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
            .map_err(|_| AppError::internal("Encryption failed"))?;
        let tag = encrypted.split_off(encrypted.len() - 16);
        Ok(Encrypted {
            ciphertext: STANDARD.encode(encrypted),
            iv: STANDARD.encode(nonce),
            auth_tag: STANDARD.encode(tag),
        })
    }
    pub fn decrypt(&self, ciphertext: &str, iv: &str, auth_tag: &str) -> Result<String, AppError> {
        let invalid = || AppError::internal("Encrypted credential is invalid");
        let mut encrypted = STANDARD.decode(ciphertext).map_err(|_| invalid())?;
        let nonce = STANDARD.decode(iv).map_err(|_| invalid())?;
        let tag = STANDARD.decode(auth_tag).map_err(|_| invalid())?;
        if nonce.len() != 12 || tag.len() != 16 {
            return Err(invalid());
        }
        encrypted.extend_from_slice(&tag);
        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|_| invalid())?;
        let plaintext = cipher
            .decrypt(Nonce::from_slice(&nonce), encrypted.as_slice())
            .map_err(|_| invalid())?;
        String::from_utf8(plaintext).map_err(|_| invalid())
    }
    #[cfg(test)]
    pub fn memory() -> Result<Self, AppError> {
        Self::initialize(Connection::open_in_memory().map_err(db_error)?, [42; 32])
    }
}

fn sql_value(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(value) => SqlValue::Integer(i64::from(*value)),
        Value::Number(value) => value
            .as_i64()
            .map(SqlValue::Integer)
            .unwrap_or_else(|| SqlValue::Real(value.as_f64().unwrap_or(0.))),
        Value::String(value) => SqlValue::Text(value.clone()),
        _ => SqlValue::Text(value.to_string()),
    }
}

fn load_key(directory: &Path) -> Result<[u8; 32], AppError> {
    #[cfg(windows)]
    {
        use sha2::{Digest, Sha256};
        let identity = hex::encode(Sha256::digest(
            directory
                .canonicalize()
                .map_err(io_error)?
                .to_string_lossy()
                .as_bytes(),
        ));
        let entry = keyring::Entry::new("Multiplexity Rust", &identity)
            .map_err(|_| AppError::internal("Credential manager unavailable"))?;
        match entry.get_password() {
            Ok(value) => hex::decode(value)
                .ok()
                .and_then(|bytes| bytes.try_into().ok())
                .ok_or_else(|| AppError::internal("Stored encryption key is invalid")),
            Err(keyring::Error::NoEntry) => {
                if directory.join("multiplexity.db").exists() {
                    return Err(AppError::internal(
                        "Encryption key missing; existing Rust data was preserved",
                    ));
                }
                let mut key = [0; 32];
                rand::thread_rng().fill_bytes(&mut key);
                entry
                    .set_password(&hex::encode(key))
                    .map_err(|_| AppError::internal("Cannot protect encryption key"))?;
                Ok(key)
            }
            Err(_) => Err(AppError::internal("Cannot unlock credential manager")),
        }
    }
    #[cfg(not(windows))]
    {
        use std::{
            fs::OpenOptions,
            io::{Read, Write},
            os::unix::fs::OpenOptionsExt,
        };
        let file = directory.join("encryption.key");
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&file)
        {
            Ok(mut handle) => {
                let mut key = [0; 32];
                rand::thread_rng().fill_bytes(&mut key);
                handle.write_all(&key).map_err(io_error)?;
                Ok(key)
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if std::fs::symlink_metadata(&file)
                    .map_err(io_error)?
                    .file_type()
                    .is_symlink()
                {
                    return Err(AppError::internal("Key file cannot be a symlink"));
                }
                let mut bytes = Vec::new();
                std::fs::File::open(file)
                    .map_err(io_error)?
                    .read_to_end(&mut bytes)
                    .map_err(io_error)?;
                bytes
                    .try_into()
                    .map_err(|_| AppError::internal("Stored encryption key is invalid"))
            }
            Err(error) => Err(io_error(error)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credentials_round_trip_and_reject_tampering() -> Result<(), AppError> {
        let store = Store::memory()?;
        for text in ["", "password contoh 🔒"] {
            let value = store.encrypt(text)?;
            assert_eq!(
                store.decrypt(&value.ciphertext, &value.iv, &value.auth_tag)?,
                text
            );
            assert!(
                store
                    .decrypt(&value.ciphertext, &value.iv, &STANDARD.encode([0; 16]))
                    .is_err()
            );
        }
        Ok(())
    }
    #[test]
    fn sqlite_preserves_types_and_bound_values() -> Result<(), AppError> {
        let store = Store::memory()?;
        let row = store
            .one(
                "SELECT ? AS text, ? AS number, ? AS empty",
                &[json!("' ; DROP TABLE users;"), json!(25), Value::Null],
            )?
            .ok_or_else(|| AppError::internal("Missing row"))?;
        assert_eq!(row["number"], 25);
        assert_eq!(row["empty"], Value::Null);
        assert!(store.query("SELECT id FROM users", &[])?.is_empty());
        Ok(())
    }
}
