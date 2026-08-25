use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::{api::ApiCommandError, path_security};

const SYNC_ROOT_SERVICE: &str = "com.mewisme.discloud.desktop.sync-root";

#[derive(Default)]
pub(crate) struct SyncRootSelectionState {
    selected: Mutex<Option<SyncRootSelection>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SyncRootSelection {
    path: PathBuf,
    server_url: String,
    remote_folder_id: String,
}

impl SyncRootSelectionState {
    fn remember(&self, selection: SyncRootSelection) -> Result<(), ApiCommandError> {
        *self
            .selected
            .lock()
            .map_err(|_| ApiCommandError::internal("Sync folder selection lock is poisoned."))? =
            Some(selection);
        Ok(())
    }

    fn consume(
        &self,
        path: &Path,
        server_url: &str,
        remote_folder_id: &str,
    ) -> Result<bool, ApiCommandError> {
        let mut selected = self
            .selected
            .lock()
            .map_err(|_| ApiCommandError::internal("Sync folder selection lock is poisoned."))?;
        if selected.as_ref().is_some_and(|selection| {
            selection.path == path
                && selection.server_url == server_url
                && selection.remote_folder_id == remote_folder_id
        }) {
            selected.take();
            Ok(true)
        } else {
            Ok(false)
        }
    }
}

#[derive(Deserialize, Serialize)]
struct SyncRootGrant {
    requested: String,
    canonical: String,
    #[serde(default)]
    identity: Option<SyncRootIdentity>,
    #[serde(default)]
    server_url: Option<String>,
    #[serde(default)]
    remote_folder_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
struct SyncRootIdentity {
    device: u64,
    file: u64,
}

pub(crate) async fn authorize_pair(
    window: &WebviewWindow,
    api: &crate::api::ApiState,
    pair_id: &str,
    local_path: &str,
    remote_folder_id: &str,
) -> Result<PathBuf, ApiCommandError> {
    validate_pair_id(pair_id)?;
    let server_url = api.connected_server_url()?;
    let mut stale_grant_error = None;
    if let Some(granted) = load(pair_id).await? {
        if local_path == granted.requested || local_path == granted.canonical {
            match verify_pair_grant(&granted, &server_url, remote_folder_id).await {
                Ok(root) => return Ok(root),
                Err(error) => stale_grant_error = Some(error),
            }
        }
    }

    let canonical = path_security::canonical_directory(local_path, "Sync local path").await?;
    if !window.state::<SyncRootSelectionState>().consume(
        &canonical,
        &server_url,
        remote_folder_id,
    )? {
        if let Some(error) = stale_grant_error {
            return Err(error);
        }
        return Err(ApiCommandError::invalid_request(
            "Sync local path must be selected with the native sync folder picker.",
        ));
    }
    save(
        pair_id,
        local_path,
        &canonical,
        &server_url,
        remote_folder_id,
    )
    .await?;
    Ok(canonical)
}

pub(crate) async fn verify_pair_authorization(
    api: &crate::api::ApiState,
    pair_id: &str,
    remote_folder_id: &str,
) -> Result<PathBuf, ApiCommandError> {
    validate_pair_id(pair_id)?;
    let server_url = api.connected_server_url()?;
    let granted = load(pair_id).await?.ok_or_else(|| {
        ApiCommandError::invalid_request(
            "Sync pair has no authorized local root. Choose the folder again.",
        )
    })?;
    verify_pair_grant(&granted, &server_url, remote_folder_id).await
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
pub(crate) async fn pick_sync_folder(
    window: WebviewWindow,
    api_state: tauri::State<'_, crate::api::ApiState>,
    remote_folder_id: String,
) -> Result<Option<String>, ApiCommandError> {
    validate_resource_id(&remote_folder_id, "remote folder ID")?;
    let server_url = api_state.connected_server_url()?;
    let selected = window
        .dialog()
        .file()
        .set_title(format!("Choose a local folder to sync with {server_url}"))
        .blocking_pick_folder();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let path = selected.into_path().map_err(|error| {
        ApiCommandError::invalid_request(format!("Could not resolve selected sync folder: {error}"))
    })?;
    let value = path
        .to_str()
        .ok_or_else(|| ApiCommandError::invalid_request("Sync local path must be valid UTF-8."))?;
    let canonical = path_security::canonical_directory(value, "Sync local path").await?;
    window
        .state::<SyncRootSelectionState>()
        .remember(SyncRootSelection {
            path: canonical.clone(),
            server_url,
            remote_folder_id,
        })?;
    canonical
        .to_str()
        .map(str::to_owned)
        .map(Some)
        .ok_or_else(|| ApiCommandError::invalid_request("Sync local path must be valid UTF-8."))
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
    server_url: &str,
    remote_folder_id: &str,
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
        server_url: Some(server_url.to_owned()),
        remote_folder_id: Some(remote_folder_id.to_owned()),
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

async fn verify_pair_grant(
    granted: &SyncRootGrant,
    server_url: &str,
    remote_folder_id: &str,
) -> Result<PathBuf, ApiCommandError> {
    if !grant_matches_pair(granted, server_url, remote_folder_id) {
        return Err(ApiCommandError::invalid_request(
            "Sync authorization does not match this server and remote folder. Choose the local folder again.",
        ));
    }
    verify_grant(granted).await
}

fn grant_matches_pair(granted: &SyncRootGrant, server_url: &str, remote_folder_id: &str) -> bool {
    granted.server_url.as_deref() == Some(server_url)
        && granted.remote_folder_id.as_deref() == Some(remote_folder_id)
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
    validate_resource_id(value, "sync pair ID")
}

fn validate_resource_id(value: &str, label: &str) -> Result<(), ApiCommandError> {
    if !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Ok(());
    }
    Err(ApiCommandError::invalid_request(format!(
        "Invalid {label}."
    )))
}

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use tokio::fs;

    use super::{
        grant_matches_pair, root_identity, validate_pair_id, SyncRootGrant, SyncRootSelection,
        SyncRootSelectionState,
    };

    #[test]
    fn validates_sync_grant_pair_ids() {
        assert!(validate_pair_id("pair-1_test").is_ok());
        assert!(validate_pair_id("").is_err());
        assert!(validate_pair_id("../pair").is_err());
    }

    #[test]
    fn sync_folder_selection_is_one_shot_and_path_bound() {
        let state = SyncRootSelectionState::default();
        let selected = PathBuf::from("selected-root");
        let other = PathBuf::from("other-root");
        state
            .remember(SyncRootSelection {
                path: selected.clone(),
                server_url: "https://cloud.example.com".to_string(),
                remote_folder_id: "remote-a".to_string(),
            })
            .unwrap();

        assert!(!state
            .consume(&other, "https://cloud.example.com", "remote-a")
            .unwrap());
        assert!(!state
            .consume(&selected, "https://other.example.com", "remote-a")
            .unwrap());
        assert!(!state
            .consume(&selected, "https://cloud.example.com", "remote-b")
            .unwrap());
        assert!(state
            .consume(&selected, "https://cloud.example.com", "remote-a")
            .unwrap());
        assert!(!state
            .consume(&selected, "https://cloud.example.com", "remote-a")
            .unwrap());
    }

    #[test]
    fn sync_grant_is_bound_to_server_and_remote_folder() {
        let grant = SyncRootGrant {
            requested: "C:\\Sync".to_string(),
            canonical: "C:\\Sync".to_string(),
            identity: None,
            server_url: Some("https://cloud.example.com".to_string()),
            remote_folder_id: Some("remote-a".to_string()),
        };
        assert!(grant_matches_pair(
            &grant,
            "https://cloud.example.com",
            "remote-a"
        ));
        assert!(!grant_matches_pair(
            &grant,
            "https://other.example.com",
            "remote-a"
        ));
        assert!(!grant_matches_pair(
            &grant,
            "https://cloud.example.com",
            "remote-b"
        ));
        let legacy = SyncRootGrant {
            server_url: None,
            remote_folder_id: None,
            ..grant
        };
        assert!(!grant_matches_pair(
            &legacy,
            "https://cloud.example.com",
            "remote-a"
        ));
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
