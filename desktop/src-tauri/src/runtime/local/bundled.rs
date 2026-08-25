use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};
use tokio::fs;

use super::{components::RuntimeComponentDescriptor, LocalRuntimeError};

const LOCAL_RUNTIME_RESOURCES_DIR: &str = "local-runtime";
const BACKEND_SIDECAR_NAME: &str = "discloud-backend";

pub(super) async fn resource_archive<R: Runtime>(
    app: &AppHandle<R>,
    descriptor: &RuntimeComponentDescriptor,
) -> Result<Option<PathBuf>, LocalRuntimeError> {
    let resource_dir = app.path().resource_dir().map_err(|error| {
        LocalRuntimeError::io("Could not resolve bundled runtime resources", error)
    })?;
    let path = resource_dir
        .join("resources")
        .join(LOCAL_RUNTIME_RESOURCES_DIR)
        .join(&descriptor.archive_name);
    if fs::try_exists(&path).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect a bundled runtime archive", error)
    })? {
        Ok(Some(path))
    } else {
        Ok(None)
    }
}

pub(super) async fn backend_sidecar() -> Result<Option<PathBuf>, LocalRuntimeError> {
    let executable = std::env::current_exe().map_err(|error| {
        LocalRuntimeError::io("Could not resolve the Desktop executable", error)
    })?;
    let Some(directory) = executable.parent() else {
        return Err(LocalRuntimeError::internal(
            "The Desktop executable has no parent directory.",
        ));
    };
    #[cfg(windows)]
    let path = directory.join(format!("{BACKEND_SIDECAR_NAME}.exe"));
    #[cfg(not(windows))]
    let path = directory.join(BACKEND_SIDECAR_NAME);
    if fs::try_exists(&path).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect the bundled backend sidecar", error)
    })? {
        Ok(Some(path))
    } else {
        Ok(None)
    }
}
