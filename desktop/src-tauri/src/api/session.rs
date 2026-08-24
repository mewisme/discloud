use keyring::{Entry, Error as KeyringError};

use crate::api::ApiCommandError;

const SESSION_SERVICE: &str = "com.mewisme.discloud.desktop.session";

pub(crate) async fn load(server_url: &str) -> Result<Option<String>, ApiCommandError> {
    let server_url = server_url.to_owned();

    tauri::async_runtime::spawn_blocking(move || load_sync(&server_url))
        .await
        .map_err(|error| {
            ApiCommandError::internal(format!("Secure session task failed: {error}"))
        })?
}

pub(crate) async fn save(server_url: &str, cookie_header: &str) -> Result<(), ApiCommandError> {
    let server_url = server_url.to_owned();
    let cookie_header = cookie_header.to_owned();

    tauri::async_runtime::spawn_blocking(move || {
        let entry = session_entry(&server_url)?;
        entry.set_password(&cookie_header).map_err(credential_error)
    })
    .await
    .map_err(|error| ApiCommandError::internal(format!("Secure session task failed: {error}")))?
}

pub(crate) async fn delete(server_url: &str) -> Result<(), ApiCommandError> {
    let server_url = server_url.to_owned();

    tauri::async_runtime::spawn_blocking(move || {
        let entry = session_entry(&server_url)?;

        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(credential_error(error)),
        }
    })
    .await
    .map_err(|error| ApiCommandError::internal(format!("Secure session task failed: {error}")))?
}

fn load_sync(server_url: &str) -> Result<Option<String>, ApiCommandError> {
    let entry = session_entry(server_url)?;

    match entry.get_password() {
        Ok(value) if value.trim().is_empty() => Ok(None),
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(credential_error(error)),
    }
}

fn session_entry(server_url: &str) -> Result<Entry, ApiCommandError> {
    Entry::new(SESSION_SERVICE, server_url).map_err(credential_error)
}

fn credential_error(error: KeyringError) -> ApiCommandError {
    ApiCommandError::internal(format!(
        "Could not access the system credential store: {error}"
    ))
}
