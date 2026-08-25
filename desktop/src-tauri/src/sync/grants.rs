use std::path::{Path, PathBuf};

use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;
use tauri_plugin_fs::FsExt;

use crate::{api::ApiCommandError, path_security};

const SYNC_ROOT_SERVICE: &str = "com.mewisme.discloud.desktop.sync-root";

#[derive(Deserialize, Serialize)]
struct SyncRootGrant {
    requested: String,
    canonical: String,
    #[serde(default)]
    identity: Option<SyncRootIdentity>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct SyncRootIdentity {
    device: u64,
    file: u64,
}

pub(crate) async fn authorize_pair(
    window: &WebviewWindow,
    pair_id: &str,
    local_path: &str,
) -> Result<PathBuf, ApiCommandError> {
    validate_pair_id(pair_id)?;
    let mut stale_grant_error = None;
    if let Some(granted) = load(pair_id).await? {
        if local_path == granted.requested || local_path == granted.canonical {
            match verify_grant(&granted).await {
                Ok(root) => return Ok(root),
                Err(error) => stale_grant_error = Some(error),
            }
        }
    }

    let requested = PathBuf::from(local_path);
    if !window.fs_scope().is_allowed(&requested) {
        if let Some(error) = stale_grant_error {
            return Err(error);
        }
        return Err(ApiCommandError::invalid_request(
            "Sync local path was not authorized by a native folder picker.",
        ));
    }

    let canonical = path_security::canonical_directory(local_path, "Sync local path").await?;
    save(pair_id, local_path, &canonical).await?;
    Ok(canonical)
}

pub(crate) async fn authorized_root(pair_id: &str) -> Result<PathBuf, ApiCommandError> {
    validate_pair_id(pair_id)?;
    let granted = load(pair_id).await?.ok_or_else(|| {
        ApiCommandError::invalid_request(
            "Sync pair has no authorized local root. Choose the folder again.",
        )
    })?;
    verify_grant(&granted).await
}

#[tauri::command]
pub(crate) async fn revoke_sync_pair_authorization(pair_id: String) -> Result<(), ApiCommandError> {
    validate_pair_id(&pair_id)?;
    delete(&pair_id).await
}

async fn load(pair_id: &str) -> Result<Option<SyncRootGrant>, ApiCommandError> {
    let pair_id = pair_id.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let entry = grant_entry(&pair_id)?;
        match entry.get_password() {
            Ok(value) if value.trim().is_empty() => Ok(None),
            Ok(value) => serde_json::from_str(&value).map(Some).map_err(|error| {
                ApiCommandError::internal(format!("Could not decode sync authorization: {error}"))
            }),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(error) => Err(credential_error(error)),
        }
    })
    .await
    .map_err(|error| {
        ApiCommandError::internal(format!("Sync authorization task failed: {error}"))
    })?
}

async fn save(
    pair_id: &str,
    requested: &str,
    path: &std::path::Path,
) -> Result<(), ApiCommandError> {
    let pair_id = pair_id.to_owned();
    let identity = root_identity(path).await?;
    let canonical = path
        .to_str()
        .ok_or_else(|| ApiCommandError::invalid_request("Sync local path must be valid UTF-8."))?
        .to_owned();
    let grant = serde_json::to_string(&SyncRootGrant {
        requested: requested.to_owned(),
        canonical,
        identity: Some(identity),
    })
    .map_err(|error| {
        ApiCommandError::internal(format!("Could not encode sync authorization: {error}"))
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        grant_entry(&pair_id)?
            .set_password(&grant)
            .map_err(credential_error)
    })
    .await
    .map_err(|error| {
        ApiCommandError::internal(format!("Sync authorization task failed: {error}"))
    })?
}

async fn verify_grant(granted: &SyncRootGrant) -> Result<PathBuf, ApiCommandError> {
    let expected = granted.identity.as_ref().ok_or_else(|| {
        ApiCommandError::invalid_request(
            "Sync local authorization must be renewed. Choose the folder again.",
        )
    })?;
    let root = path_security::canonical_granted_directory(
        &granted.canonical,
        "Authorized sync local path",
    )
    .await?;
    let current = root_identity(&root).await?;
    if &current != expected {
        return Err(ApiCommandError::invalid_request(
            "Sync local folder changed since it was authorized. Choose the folder again.",
        ));
    }
    Ok(root)
}

#[cfg(windows)]
async fn root_identity(path: &Path) -> Result<SyncRootIdentity, ApiCommandError> {
    use std::os::windows::ffi::OsStrExt;

    use windows::{
        core::PCWSTR,
        Win32::{
            Foundation::CloseHandle,
            Storage::FileSystem::{
                CreateFileW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
                FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
                OPEN_EXISTING,
            },
        },
    };

    let path = path.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let mut wide = path.as_os_str().encode_wide().collect::<Vec<_>>();
        wide.push(0);
        let handle = unsafe {
            CreateFileW(
                PCWSTR(wide.as_ptr()),
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                None,
            )
        }
        .map_err(|error| {
            ApiCommandError::invalid_request(format!(
                "Could not open authorized sync root for identity verification: {error}"
            ))
        })?;
        let mut info = BY_HANDLE_FILE_INFORMATION::default();
        let result = unsafe { GetFileInformationByHandle(handle, &mut info) };
        let _ = unsafe { CloseHandle(handle) };
        result.map_err(|error| {
            ApiCommandError::invalid_request(format!(
                "Could not read authorized sync root identity: {error}"
            ))
        })?;
        Ok(SyncRootIdentity {
            device: u64::from(info.dwVolumeSerialNumber),
            file: (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow),
        })
    })
    .await
    .map_err(|error| {
        ApiCommandError::internal(format!("Sync root identity task failed: {error}"))
    })?
}

#[cfg(unix)]
async fn root_identity(path: &Path) -> Result<SyncRootIdentity, ApiCommandError> {
    use std::os::unix::fs::MetadataExt;

    let metadata = tokio::fs::metadata(path).await.map_err(|error| {
        ApiCommandError::invalid_request(format!("Could not inspect authorized sync root: {error}"))
    })?;
    Ok(SyncRootIdentity {
        device: metadata.dev(),
        file: metadata.ino(),
    })
}

#[cfg(not(any(unix, windows)))]
async fn root_identity(_path: &Path) -> Result<SyncRootIdentity, ApiCommandError> {
    Err(ApiCommandError::internal(
        "Persistent sync authorization is not supported on this platform.",
    ))
}

async fn delete(pair_id: &str) -> Result<(), ApiCommandError> {
    let pair_id = pair_id.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let entry = grant_entry(&pair_id)?;
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(credential_error(error)),
        }
    })
    .await
    .map_err(|error| {
        ApiCommandError::internal(format!("Sync authorization task failed: {error}"))
    })?
}

fn grant_entry(pair_id: &str) -> Result<Entry, ApiCommandError> {
    Entry::new(SYNC_ROOT_SERVICE, pair_id).map_err(credential_error)
}

fn credential_error(error: KeyringError) -> ApiCommandError {
    ApiCommandError::internal(format!(
        "Could not access the system credential store for sync authorization: {error}"
    ))
}

fn validate_pair_id(value: &str) -> Result<(), ApiCommandError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(ApiCommandError::invalid_request("Invalid sync pair ID."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use tokio::fs;

    use super::{root_identity, validate_pair_id};

    #[test]
    fn validates_sync_grant_pair_ids() {
        assert!(validate_pair_id("pair-1_test").is_ok());
        assert!(validate_pair_id("").is_err());
        assert!(validate_pair_id("../pair").is_err());
    }

    #[tokio::test]
    async fn filesystem_identity_detects_same_path_replacement() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "discloud-sync-grant-{}-{nonce}",
            std::process::id()
        ));
        let root = base.join("root");
        let replacement = base.join("replacement");
        fs::create_dir_all(&root).await.unwrap();
        fs::create_dir_all(&replacement).await.unwrap();
        let original_identity = root_identity(&root).await.unwrap();
        let replacement_identity = root_identity(&replacement).await.unwrap();
        assert_ne!(original_identity, replacement_identity);

        fs::remove_dir(&root).await.unwrap();
        fs::rename(&replacement, &root).await.unwrap();
        let current_identity = root_identity(&root).await.unwrap();
        assert_eq!(current_identity, replacement_identity);
        assert_ne!(current_identity, original_identity);

        let _ = fs::remove_dir_all(base).await;
    }
}
