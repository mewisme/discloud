use std::path::PathBuf;

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
}

pub(crate) async fn authorize_pair(
    window: &WebviewWindow,
    pair_id: &str,
    local_path: &str,
) -> Result<PathBuf, ApiCommandError> {
    validate_pair_id(pair_id)?;
    if let Some(granted) = load(pair_id).await? {
        if local_path == granted.requested || local_path == granted.canonical {
            return path_security::canonical_directory(
                &granted.canonical,
                "Authorized sync local path",
            )
            .await;
        }
    }

    let requested = PathBuf::from(local_path);
    if !window.fs_scope().is_allowed(&requested) {
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
    path_security::canonical_directory(&granted.canonical, "Authorized sync local path").await
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
    let canonical = path
        .to_str()
        .ok_or_else(|| ApiCommandError::invalid_request("Sync local path must be valid UTF-8."))?
        .to_owned();
    let grant = serde_json::to_string(&SyncRootGrant {
        requested: requested.to_owned(),
        canonical,
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
    use super::validate_pair_id;

    #[test]
    fn validates_sync_grant_pair_ids() {
        assert!(validate_pair_id("pair-1_test").is_ok());
        assert!(validate_pair_id("").is_err());
        assert!(validate_pair_id("../pair").is_err());
    }
}
