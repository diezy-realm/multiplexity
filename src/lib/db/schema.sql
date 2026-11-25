-- Dashboard users
CREATE TABLE IF NOT EXISTS snippets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('credential','path','script')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS app_preferences (user_id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, public_key BLOB NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS auth_challenges (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, purpose TEXT NOT NULL, value TEXT NOT NULL, origin TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS password_grants (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS ui_preferences (
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, scope)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME
);

-- Virtual Machines
CREATE TABLE IF NOT EXISTS vms (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  label TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER DEFAULT 22,
  username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  encryption_auth_tag TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- VM Status tracking
CREATE TABLE IF NOT EXISTS vm_status (
  vm_id TEXT PRIMARY KEY REFERENCES vms(id) ON DELETE CASCADE,
  status TEXT CHECK(status IN ('online', 'offline', 'unreachable')) DEFAULT 'offline',
  last_checked DATETIME,
  fail_count INTEGER DEFAULT 0
);

-- Session tracking (for audit)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  is_active INTEGER DEFAULT 1
);

-- AI Provider settings
CREATE TABLE IF NOT EXISTS ai_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  provider TEXT NOT NULL DEFAULT 'openai',
  api_key_encrypted TEXT NOT NULL DEFAULT '',
  api_key_iv TEXT NOT NULL DEFAULT '',
  api_key_auth_tag TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Database Connections
CREATE TABLE IF NOT EXISTS kong_connections (
  user_id TEXT PRIMARY KEY,
  admin_url TEXT NOT NULL,
  token_encrypted TEXT NOT NULL DEFAULT '',
  token_iv TEXT NOT NULL DEFAULT '',
  token_auth_tag TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Chat baru',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ai_conversations_user_idx ON ai_conversations(user_id, updated_at);
CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS artifact_versions_file_idx ON artifact_versions(user_id,name,created_at);
CREATE TABLE IF NOT EXISTS ai_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  conversation_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ai_chat_user_idx ON ai_chat_messages(user_id, id);

CREATE TABLE IF NOT EXISTS ai_connections (
  provider TEXT PRIMARY KEY,
  model TEXT NOT NULL DEFAULT '',
  api_key_encrypted TEXT NOT NULL DEFAULT '',
  api_key_iv TEXT NOT NULL DEFAULT '',
  api_key_auth_tag TEXT NOT NULL DEFAULT '',
  cli_path TEXT NOT NULL DEFAULT '',
  endpoint TEXT NOT NULL DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO ai_connections (provider, model, api_key_encrypted, api_key_iv, api_key_auth_tag)
SELECT provider, model, api_key_encrypted, api_key_iv, api_key_auth_tag FROM ai_settings
WHERE id = 'default' AND provider = 'openai' AND api_key_encrypted != '';

CREATE TABLE IF NOT EXISTS database_connections (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  vm_id TEXT REFERENCES vms(id) ON DELETE SET NULL,
  db_type TEXT NOT NULL CHECK(db_type IN ('mysql', 'postgresql', 'mariadb')),
  host TEXT NOT NULL DEFAULT 'localhost',
  port INTEGER NOT NULL,
  db_username TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  encryption_auth_tag TEXT NOT NULL,
  label TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Query History
CREATE TABLE IF NOT EXISTS query_history (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  connection_id TEXT NOT NULL REFERENCES database_connections(id) ON DELETE CASCADE,
  database_name TEXT,
  query_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'error')),
  error_message TEXT,
  execution_time_ms INTEGER,
  row_count INTEGER,
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient history lookup and cleanup
CREATE INDEX IF NOT EXISTS idx_query_history_connection 
  ON query_history(connection_id, executed_at DESC);

CREATE TABLE IF NOT EXISTS openshift_connections (
  user_id TEXT PRIMARY KEY,
  api_url TEXT NOT NULL,
  console_url TEXT NOT NULL DEFAULT '',
  token_encrypted TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  token_auth_tag TEXT NOT NULL,
  insecure_tls INTEGER NOT NULL DEFAULT 1,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS openshift_clusters (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  api_url TEXT NOT NULL,
  console_url TEXT NOT NULL DEFAULT '',
  auth_type TEXT NOT NULL DEFAULT 'oauth_password' CHECK(auth_type IN ('oauth_password', 'token')),
  idp TEXT NOT NULL DEFAULT 'Local Login',
  username TEXT NOT NULL DEFAULT '',
  token_encrypted TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  token_auth_tag TEXT NOT NULL,
  insecure_tls INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_openshift_clusters_user
  ON openshift_clusters(user_id, updated_at DESC);
