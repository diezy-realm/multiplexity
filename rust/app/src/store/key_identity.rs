use super::{Store, io_error};
use crate::AppError;
use rand::RngCore;
use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::Path,
};

const ID_FILE: &str = "keyring-id";
pub(super) trait Vault {
    fn read(&self, identity: &str) -> Result<Option<[u8; 32]>, AppError>;
    fn write(&self, identity: &str, key: &[u8; 32]) -> Result<(), AppError>;
}

#[cfg(windows)]
pub(super) struct WindowsVault;
#[cfg(windows)]
impl Vault for WindowsVault {
    fn read(&self, identity: &str) -> Result<Option<[u8; 32]>, AppError> {
        let entry = keyring::Entry::new("Multiplexity Rust", identity)
            .map_err(|_| AppError::internal("Credential manager unavailable"))?;
        match entry.get_password() {
            Ok(value) => hex::decode(value)
                .ok()
                .and_then(|bytes| bytes.try_into().ok())
                .map(Some)
                .ok_or_else(|| AppError::internal("Stored encryption key is invalid")),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(AppError::internal("Cannot unlock credential manager")),
        }
    }
    fn write(&self, identity: &str, key: &[u8; 32]) -> Result<(), AppError> {
        keyring::Entry::new("Multiplexity Rust", identity)
            .map_err(|_| AppError::internal("Credential manager unavailable"))?
            .set_password(&hex::encode(key))
            .map_err(|_| AppError::internal("Cannot protect encryption key"))
    }
}

fn legacy_identity(directory: &Path) -> Result<String, AppError> {
    Ok(hex::encode(Sha256::digest(
        directory
            .canonicalize()
            .map_err(io_error)?
            .to_string_lossy()
            .as_bytes(),
    )))
}
fn read_identity(directory: &Path) -> Result<Option<String>, AppError> {
    let path = directory.join(ID_FILE);
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error(error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 66 {
        return Err(AppError::internal("Invalid encryption key reference"));
    }
    let mut value = String::new();
    std::fs::File::open(path)
        .map_err(io_error)?
        .take(67)
        .read_to_string(&mut value)
        .map_err(io_error)?;
    let identity = value.trim();
    if identity.len() != 64 || !identity.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::internal("Invalid encryption key reference"));
    }
    Ok(Some(identity.to_owned()))
}
fn save_identity(directory: &Path, identity: &str) -> Result<(), AppError> {
    match std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(directory.join(ID_FILE))
    {
        Ok(mut file) => {
            file.write_all(identity.as_bytes()).map_err(io_error)?;
            file.sync_all().map_err(io_error)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            if read_identity(directory)?.as_deref() == Some(identity) {
                Ok(())
            } else {
                Err(AppError::internal(
                    "Encryption key reference already exists; no changes were made",
                ))
            }
        }
        Err(error) => Err(io_error(error)),
    }
}
fn missing_key() -> AppError {
    AppError::internal(
        "Encryption key missing; existing Rust data was preserved. Recover with --recover-key-from <previous-data-directory> using the same Windows account",
    )
}
pub(super) fn load(directory: &Path, vault: &impl Vault) -> Result<[u8; 32], AppError> {
    if let Some(identity) = read_identity(directory)? {
        let key = vault.read(&identity)?.ok_or_else(missing_key)?;
        verify_database(directory, key)?;
        return Ok(key);
    }
    let legacy = legacy_identity(directory)?;
    if let Some(key) = vault.read(&legacy)? {
        verify_database(directory, key)?;
        save_identity(directory, &legacy)?;
        return Ok(key);
    }
    if directory.join("multiplexity.db").exists() {
        return Err(missing_key());
    }
    let mut key = [0; 32];
    let mut identifier = [0; 32];
    rand::thread_rng().fill_bytes(&mut key);
    rand::thread_rng().fill_bytes(&mut identifier);
    let identity = hex::encode(identifier);
    vault.write(&identity, &key)?;
    save_identity(directory, &identity)?;
    Ok(key)
}
fn verify_database(directory: &Path, key: [u8; 32]) -> Result<(), AppError> {
    let path = directory.join("multiplexity.db");
    if !path.is_file() {
        return Ok(());
    }
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| AppError::internal("Cannot verify existing database"))?;
    let store = Store {
        connection: std::sync::Mutex::new(connection),
        key,
    };
    for (table, ciphertext, iv, tag) in [
        ("snippets", "ciphertext", "iv", "auth_tag"),
        (
            "vms",
            "encrypted_password",
            "encryption_iv",
            "encryption_auth_tag",
        ),
        (
            "database_connections",
            "encrypted_password",
            "encryption_iv",
            "encryption_auth_tag",
        ),
        (
            "ai_settings",
            "api_key_encrypted",
            "api_key_iv",
            "api_key_auth_tag",
        ),
        (
            "ai_connections",
            "api_key_encrypted",
            "api_key_iv",
            "api_key_auth_tag",
        ),
        (
            "kong_connections",
            "token_encrypted",
            "token_iv",
            "token_auth_tag",
        ),
        (
            "openshift_connections",
            "token_encrypted",
            "token_iv",
            "token_auth_tag",
        ),
        (
            "openshift_clusters",
            "token_encrypted",
            "token_iv",
            "token_auth_tag",
        ),
    ] {
        if store
            .one(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                &[serde_json::json!(table)],
            )?
            .is_none()
        {
            continue;
        }
        let rows = store.query(&format!("SELECT {ciphertext} AS ciphertext,{iv} AS iv,{tag} AS tag FROM {table} WHERE {ciphertext}!='' LIMIT 20"), &[])?;
        for row in rows {
            store
                .decrypt(
                    row["ciphertext"].as_str().unwrap_or_default(),
                    row["iv"].as_str().unwrap_or_default(),
                    row["tag"].as_str().unwrap_or_default(),
                )
                .map_err(|_| {
                    AppError::bad_request(
                        "Source key does not match this database; no key reference was changed",
                    )
                })?;
        }
    }
    Ok(())
}
pub(super) fn recover(directory: &Path, source: &Path, vault: &impl Vault) -> Result<(), AppError> {
    if !directory.join("multiplexity.db").is_file() {
        return Err(AppError::bad_request(
            "Existing target database is required",
        ));
    }
    let identity = read_identity(source)?
        .map(Ok)
        .unwrap_or_else(|| legacy_identity(source))?;
    let key = vault.read(&identity)?.ok_or_else(missing_key)?;
    verify_database(directory, key)?;
    save_identity(directory, &identity)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::HashMap, sync::Mutex};
    #[derive(Default)]
    struct MemoryVault(Mutex<HashMap<String, [u8; 32]>>);
    impl Vault for MemoryVault {
        fn read(&self, id: &str) -> Result<Option<[u8; 32]>, AppError> {
            Ok(self.0.lock().expect("fixture lock").get(id).copied())
        }
        fn write(&self, id: &str, key: &[u8; 32]) -> Result<(), AppError> {
            self.0.lock().expect("fixture lock").insert(id.into(), *key);
            Ok(())
        }
    }
    fn database(directory: &Path, key: [u8; 32]) -> Result<(), AppError> {
        let store = Store::initialize(
            Connection::open(directory.join("multiplexity.db")).map_err(super::super::db_error)?,
            key,
        )?;
        let encrypted = store.encrypt("relocation fixture")?;
        store.execute("INSERT INTO snippets(id,user_id,title,kind,ciphertext,iv,auth_tag) VALUES('fixture','user','Fixture','credential',?,?,?)", &[serde_json::json!(encrypted.ciphertext),serde_json::json!(encrypted.iv),serde_json::json!(encrypted.auth_tag)])?;
        Ok(())
    }
    #[test]
    fn legacy_profile_gets_reference_without_rotating_key() -> Result<(), AppError> {
        let directory = tempfile::tempdir().expect("fixture directory");
        let vault = MemoryVault::default();
        let identity = legacy_identity(directory.path())?;
        vault.write(&identity, &[5; 32])?;
        database(directory.path(), [5; 32])?;
        assert_eq!(load(directory.path(), &vault)?, [5; 32]);
        assert_eq!(read_identity(directory.path())?, Some(identity));
        assert_eq!(vault.0.lock().expect("fixture lock").len(), 1);
        Ok(())
    }
    #[test]
    fn stable_reference_survives_directory_rename() -> Result<(), AppError> {
        let root = tempfile::tempdir().expect("fixture directory");
        let old = root.path().join("old");
        let moved = root.path().join("moved");
        std::fs::create_dir(&old).map_err(io_error)?;
        let vault = MemoryVault::default();
        let key = load(&old, &vault)?;
        database(&old, key)?;
        std::fs::rename(&old, &moved).map_err(io_error)?;
        assert_eq!(load(&moved, &vault)?, key);
        verify_database(&moved, key)?;
        Ok(())
    }
    #[test]
    fn legacy_copy_requires_explicit_matching_source() -> Result<(), AppError> {
        let root = tempfile::tempdir().expect("fixture directory");
        let old = root.path().join("old");
        let moved = root.path().join("moved");
        std::fs::create_dir(&old).map_err(io_error)?;
        std::fs::create_dir(&moved).map_err(io_error)?;
        let vault = MemoryVault::default();
        vault.write(&legacy_identity(&old)?, &[7; 32])?;
        database(&old, [7; 32])?;
        std::fs::copy(old.join("multiplexity.db"), moved.join("multiplexity.db"))
            .map_err(io_error)?;
        assert!(load(&moved, &vault).is_err());
        assert!(!moved.join(ID_FILE).exists());
        recover(&moved, &old, &vault)?;
        assert_eq!(load(&moved, &vault)?, [7; 32]);
        verify_database(&moved, [7; 32])?;
        Ok(())
    }
    #[test]
    fn recovery_rejects_wrong_key_without_changing_reference() -> Result<(), AppError> {
        let root = tempfile::tempdir().expect("fixture directory");
        let source = root.path().join("wrong");
        let target = root.path().join("target");
        std::fs::create_dir(&source).map_err(io_error)?;
        std::fs::create_dir(&target).map_err(io_error)?;
        let vault = MemoryVault::default();
        let _ = load(&source, &vault)?;
        database(&target, [8; 32])?;
        assert!(recover(&target, &source, &vault).is_err());
        assert!(!target.join(ID_FILE).exists());
        verify_database(&target, [8; 32])?;
        Ok(())
    }
    #[test]
    fn missing_or_corrupt_reference_never_rotates_existing_keys() -> Result<(), AppError> {
        let directory = tempfile::tempdir().expect("fixture directory");
        let vault = MemoryVault::default();
        let key = load(directory.path(), &vault)?;
        database(directory.path(), key)?;
        vault.0.lock().expect("fixture lock").clear();
        assert!(load(directory.path(), &vault).is_err());
        std::fs::write(directory.path().join(ID_FILE), "invalid").map_err(io_error)?;
        assert!(load(directory.path(), &vault).is_err());
        assert!(vault.0.lock().expect("fixture lock").is_empty());
        Ok(())
    }
}
