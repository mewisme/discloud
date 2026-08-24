use std::path::{Path, PathBuf};

use tauri::WebviewWindow;
use tauri_plugin_fs::FsExt;
use tokio::fs;

use crate::api::ApiCommandError;

pub(crate) async fn scoped_existing_file(
    window: &WebviewWindow,
    value: &str,
    label: &str,
) -> Result<PathBuf, ApiCommandError> {
    let path = absolute_path(value, label)?;
    ensure_scoped(window, &path, label)?;
    let metadata = fs::symlink_metadata(&path)
        .await
        .map_err(|error| invalid_path(label, format!("could not inspect path: {error}")))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(invalid_path(label, "must point to a regular file"));
    }
    let canonical = fs::canonicalize(&path)
        .await
        .map_err(|error| invalid_path(label, format!("could not resolve path: {error}")))?;
    ensure_scoped(window, &canonical, label)?;
    Ok(canonical)
}

pub(crate) async fn scoped_existing_directory(
    window: &WebviewWindow,
    value: &str,
    label: &str,
) -> Result<PathBuf, ApiCommandError> {
    let path = absolute_path(value, label)?;
    ensure_scoped(window, &path, label)?;
    canonical_existing_directory(&path, label, Some(window)).await
}

pub(crate) async fn scoped_output_file(
    window: &WebviewWindow,
    value: &str,
    label: &str,
) -> Result<PathBuf, ApiCommandError> {
    let path = absolute_path(value, label)?;
    ensure_scoped(window, &path, label)?;
    let name = path
        .file_name()
        .ok_or_else(|| invalid_path(label, "must be a file path"))?;
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| invalid_path(label, "must have a parent directory"))?;
    let parent_metadata = fs::symlink_metadata(parent).await.map_err(|error| {
        invalid_path(
            label,
            format!("could not inspect parent directory: {error}"),
        )
    })?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err(invalid_path(label, "parent must be a regular directory"));
    }
    let canonical_parent = fs::canonicalize(parent).await.map_err(|error| {
        invalid_path(
            label,
            format!("could not resolve parent directory: {error}"),
        )
    })?;
    let canonical = canonical_parent.join(name);
    ensure_scoped(window, &canonical, label)?;
    match fs::symlink_metadata(&canonical).await {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(invalid_path(label, "must not be a symbolic link"))
        }
        Ok(metadata) if !metadata.is_file() => Err(invalid_path(label, "must be a file path")),
        Ok(_) => Ok(canonical),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(canonical),
        Err(error) => Err(invalid_path(
            label,
            format!("could not inspect destination: {error}"),
        )),
    }
}

pub(crate) async fn scoped_existing_path(
    window: &WebviewWindow,
    value: &str,
    label: &str,
) -> Result<PathBuf, ApiCommandError> {
    let path = absolute_path(value, label)?;
    ensure_scoped(window, &path, label)?;
    let metadata = fs::symlink_metadata(&path)
        .await
        .map_err(|error| invalid_path(label, format!("could not inspect path: {error}")))?;
    if metadata.file_type().is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
        return Err(invalid_path(
            label,
            "must point to a regular file or directory",
        ));
    }
    let canonical = fs::canonicalize(&path)
        .await
        .map_err(|error| invalid_path(label, format!("could not resolve path: {error}")))?;
    ensure_scoped(window, &canonical, label)?;
    Ok(canonical)
}

pub(crate) async fn scoped_existing_file_path(
    window: &WebviewWindow,
    path: &Path,
    label: &str,
) -> Result<PathBuf, ApiCommandError> {
    let value = path
        .to_str()
        .ok_or_else(|| invalid_path(label, "must be valid UTF-8"))?;
    scoped_existing_file(window, value, label).await
}

pub(crate) async fn canonical_directory(
    value: &str,
    label: &str,
) -> Result<PathBuf, ApiCommandError> {
    let path = absolute_path(value, label)?;
    canonical_existing_directory(&path, label, None).await
}

pub(crate) async fn canonical_path_within(
    root: &Path,
    value: &str,
    label: &str,
) -> Result<PathBuf, ApiCommandError> {
    let path = absolute_path(value, label)?;
    let metadata = fs::symlink_metadata(&path)
        .await
        .map_err(|error| invalid_path(label, format!("could not inspect path: {error}")))?;
    if metadata.file_type().is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
        return Err(invalid_path(
            label,
            "must point to a regular file or directory",
        ));
    }
    let canonical = fs::canonicalize(&path)
        .await
        .map_err(|error| invalid_path(label, format!("could not resolve path: {error}")))?;
    let canonical_root = fs::canonicalize(root).await.map_err(|error| {
        invalid_path(label, format!("could not resolve authorized root: {error}"))
    })?;
    if canonical != canonical_root && !canonical.starts_with(&canonical_root) {
        return Err(invalid_path(label, "is outside the authorized local root"));
    }
    Ok(canonical)
}

fn absolute_path(value: &str, label: &str) -> Result<PathBuf, ApiCommandError> {
    if value.is_empty() || value.trim() != value {
        return Err(invalid_path(
            label,
            "is required and must not contain surrounding whitespace",
        ));
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(invalid_path(label, "must be an absolute path"));
    }
    reject_device_namespace(&path, label)?;
    Ok(path)
}

async fn canonical_existing_directory(
    path: &Path,
    label: &str,
    window: Option<&WebviewWindow>,
) -> Result<PathBuf, ApiCommandError> {
    let metadata = fs::symlink_metadata(path)
        .await
        .map_err(|error| invalid_path(label, format!("could not inspect path: {error}")))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(invalid_path(label, "must point to a regular directory"));
    }
    let canonical = fs::canonicalize(path)
        .await
        .map_err(|error| invalid_path(label, format!("could not resolve path: {error}")))?;
    if let Some(window) = window {
        ensure_scoped(window, &canonical, label)?;
    }
    Ok(canonical)
}

fn ensure_scoped(window: &WebviewWindow, path: &Path, label: &str) -> Result<(), ApiCommandError> {
    if window.fs_scope().is_allowed(path) {
        Ok(())
    } else {
        Err(invalid_path(
            label,
            "was not authorized by a native file picker or drag-and-drop action",
        ))
    }
}

#[cfg(windows)]
fn reject_device_namespace(path: &Path, label: &str) -> Result<(), ApiCommandError> {
    use std::path::{Component, Prefix};

    let Some(Component::Prefix(prefix)) = path.components().next() else {
        return Ok(());
    };
    if matches!(prefix.kind(), Prefix::DeviceNS(_) | Prefix::Verbatim(_)) {
        return Err(invalid_path(
            label,
            "must not use a Windows device namespace",
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn reject_device_namespace(_path: &Path, _label: &str) -> Result<(), ApiCommandError> {
    Ok(())
}

fn invalid_path(label: &str, reason: impl AsRef<str>) -> ApiCommandError {
    ApiCommandError::invalid_request(format!("{label} {}.", reason.as_ref()))
}

#[cfg(test)]
mod tests {
    use super::absolute_path;

    #[test]
    fn rejects_relative_and_trimmed_paths() {
        assert!(absolute_path("relative/file.txt", "Path").is_err());
        assert!(absolute_path(" relative/file.txt ", "Path").is_err());
    }

    #[test]
    fn accepts_platform_absolute_path() {
        #[cfg(windows)]
        assert!(absolute_path(r"C:\Users\test\file.txt", "Path").is_ok());
        #[cfg(not(windows))]
        assert!(absolute_path("/tmp/file.txt", "Path").is_ok());
    }
}
