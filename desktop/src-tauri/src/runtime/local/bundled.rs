use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};
use tokio::fs;

use super::{
    components::{RuntimeComponentDescriptor, RuntimeComponentKind},
    LocalRuntimeError,
};

const LOCAL_RUNTIME_RESOURCES_DIR: &str = "local-runtime";
const BACKEND_SIDECAR_NAME: &str = "discloud-backend";

pub(super) async fn resource_directory<R: Runtime>(
    app: &AppHandle<R>,
    descriptor: &RuntimeComponentDescriptor,
) -> Result<Option<PathBuf>, LocalRuntimeError> {
    let component = match descriptor.kind {
        RuntimeComponentKind::PostgreSQL => "postgresql",
        RuntimeComponentKind::Web => "web",
        RuntimeComponentKind::Backend => return Ok(None),
    };
    let resource_dir = app.path().resource_dir().map_err(|error| {
        LocalRuntimeError::io("Could not resolve bundled runtime resources", error)
    })?;
    let path = resource_dir
        .join("resources")
        .join(LOCAL_RUNTIME_RESOURCES_DIR)
        .join(component)
        .join(&descriptor.version);
    if fs::try_exists(&path).await.map_err(|error| {
        LocalRuntimeError::io("Could not inspect a bundled runtime directory", error)
    })? {
        Ok(Some(path))
    } else {
        Ok(None)
    }
}

pub(super) async fn copy_resource_directory(
    source: &Path,
    destination: &Path,
) -> Result<(), LocalRuntimeError> {
    let source = source.to_path_buf();
    let destination = destination.to_path_buf();
    tokio::task::spawn_blocking(move || copy_resource_directory_blocking(&source, &destination))
        .await
        .map_err(|error| {
            LocalRuntimeError::internal(format!("Bundled runtime copy task failed: {error}"))
        })??;
    Ok(())
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

fn copy_resource_directory_blocking(
    source: &Path,
    destination: &Path,
) -> Result<(), LocalRuntimeError> {
    if destination.exists() {
        std::fs::remove_dir_all(destination).map_err(|error| {
            LocalRuntimeError::io("Could not reset the managed runtime directory", error)
        })?;
    }
    std::fs::create_dir_all(destination).map_err(|error| {
        LocalRuntimeError::io("Could not create the managed runtime directory", error)
    })?;
    copy_directory_contents(source, destination)
}

fn copy_directory_contents(source: &Path, destination: &Path) -> Result<(), LocalRuntimeError> {
    for entry in std::fs::read_dir(source).map_err(|error| {
        LocalRuntimeError::io("Could not read a bundled runtime directory", error)
    })? {
        let entry = entry.map_err(|error| {
            LocalRuntimeError::io("Could not read a bundled runtime entry", error)
        })?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| {
            LocalRuntimeError::io("Could not inspect a bundled runtime entry", error)
        })?;
        if file_type.is_dir() {
            std::fs::create_dir_all(&destination_path).map_err(|error| {
                LocalRuntimeError::io("Could not create a managed runtime directory", error)
            })?;
            copy_directory_contents(&source_path, &destination_path)?;
        } else {
            std::fs::copy(&source_path, &destination_path).map_err(|error| {
                LocalRuntimeError::io("Could not copy a bundled runtime file", error)
            })?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::copy_resource_directory_blocking;

    #[test]
    fn copies_nested_and_hidden_runtime_files() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "discloud-bundled-runtime-copy-{}-{nonce}",
            std::process::id()
        ));
        let source = root.join("source");
        let destination = root.join("destination");
        let hidden = source.join("web").join(".next").join("server");
        std::fs::create_dir_all(&hidden).unwrap();
        std::fs::write(source.join("node.exe"), b"node").unwrap();
        std::fs::write(hidden.join("runtime.js"), b"runtime").unwrap();

        copy_resource_directory_blocking(&source, &destination).unwrap();

        assert_eq!(
            std::fs::read(destination.join("node.exe")).unwrap(),
            b"node"
        );
        assert_eq!(
            std::fs::read(
                destination
                    .join("web")
                    .join(".next")
                    .join("server")
                    .join("runtime.js")
            )
            .unwrap(),
            b"runtime"
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
