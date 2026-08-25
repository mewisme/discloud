use std::path::{Component, Path, PathBuf};

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
    let canonical = output_file_path(&path, label).await?;
    ensure_scoped(window, &canonical, label)?;
    Ok(canonical)
}

pub(crate) async fn output_file_path(path: &Path, label: &str) -> Result<PathBuf, ApiCommandError> {
    let value = path
        .to_str()
        .ok_or_else(|| invalid_path(label, "must be valid UTF-8"))?;
    let path = absolute_path(value, label)?;
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

pub(crate) async fn canonical_granted_directory(
    value: &str,
    label: &str,
) -> Result<PathBuf, ApiCommandError> {
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(invalid_path(
            label,
            "stored authorization is not an absolute path",
        ));
    }
    let canonical = canonical_existing_directory(&path, label, None).await?;
    if !same_canonical_path(&path, &canonical) {
        return Err(invalid_path(
            label,
            "no longer resolves to the directory that was originally authorized",
        ));
    }
    Ok(canonical)
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
    let canonical_root = canonical_root(root, label).await?;
    if canonical != canonical_root && !canonical.starts_with(&canonical_root) {
        return Err(invalid_path(label, "is outside the authorized local root"));
    }
    Ok(canonical)
}

pub(crate) fn safe_relative_path(value: &str, label: &str) -> Result<PathBuf, ApiCommandError> {
    if value.is_empty() || value.as_bytes().contains(&0) {
        return Err(invalid_path(label, "must be a non-empty relative path"));
    }
    #[cfg(windows)]
    if value.contains('\\') {
        return Err(invalid_path(label, "must use normalized path separators"));
    }

    let path = Path::new(value);
    if path.is_absolute() {
        return Err(invalid_path(label, "must be a relative path"));
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        let Component::Normal(segment) = component else {
            return Err(invalid_path(label, "contains an unsafe path component"));
        };
        #[cfg(windows)]
        validate_windows_component(segment, label)?;
        normalized.push(segment);
    }
    if normalized.as_os_str().is_empty() {
        return Err(invalid_path(label, "must be a non-empty relative path"));
    }
    Ok(normalized)
}

pub(crate) async fn checked_child_path(
    root: &Path,
    relative: &str,
    label: &str,
) -> Result<PathBuf, ApiCommandError> {
    let root = canonical_root(root, label).await?;
    let relative = safe_relative_path(relative, label)?;
    inspect_child_components(&root, &relative, label).await?;
    Ok(root.join(relative))
}

pub(crate) async fn ensure_child_directory(
    root: &Path,
    relative: &str,
    label: &str,
) -> Result<PathBuf, ApiCommandError> {
    let root = canonical_root(root, label).await?;
    let relative = safe_relative_path(relative, label)?;
    let mut current = root;
    for component in relative.components() {
        let Component::Normal(segment) = component else {
            return Err(invalid_path(label, "contains an unsafe path component"));
        };
        current.push(segment);
        match fs::symlink_metadata(&current).await {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(invalid_path(
                    label,
                    "contains a symbolic link or non-directory component",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                match fs::create_dir(&current).await {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                    Err(error) => {
                        return Err(invalid_path(
                            label,
                            format!("could not create directory: {error}"),
                        ))
                    }
                }
                let metadata = fs::symlink_metadata(&current).await.map_err(|error| {
                    invalid_path(
                        label,
                        format!("could not verify created directory: {error}"),
                    )
                })?;
                if metadata.file_type().is_symlink() || !metadata.is_dir() {
                    return Err(invalid_path(
                        label,
                        "created path is not a regular directory",
                    ));
                }
            }
            Err(error) => {
                return Err(invalid_path(
                    label,
                    format!("could not inspect directory: {error}"),
                ))
            }
        }
    }
    Ok(current)
}

pub(crate) async fn checked_child_output_file(
    root: &Path,
    relative: &str,
    label: &str,
) -> Result<PathBuf, ApiCommandError> {
    let root = canonical_root(root, label).await?;
    let relative = safe_relative_path(relative, label)?;
    let parent = relative
        .parent()
        .filter(|path| !path.as_os_str().is_empty());
    if let Some(parent) = parent {
        let parent = parent
            .to_str()
            .ok_or_else(|| invalid_path(label, "must be valid UTF-8"))?;
        ensure_child_directory(&root, parent, label).await?;
    }
    let target = root.join(&relative);
    match fs::symlink_metadata(&target).await {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(invalid_path(label, "must not be a symbolic link"))
        }
        Ok(metadata) if !metadata.is_file() => {
            Err(invalid_path(label, "must resolve to a file path"))
        }
        Ok(_) => Ok(target),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(target),
        Err(error) => Err(invalid_path(
            label,
            format!("could not inspect destination: {error}"),
        )),
    }
}

async fn canonical_root(root: &Path, label: &str) -> Result<PathBuf, ApiCommandError> {
    let metadata = fs::symlink_metadata(root).await.map_err(|error| {
        invalid_path(label, format!("could not inspect authorized root: {error}"))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(invalid_path(
            label,
            "authorized root must be a regular directory",
        ));
    }
    let canonical = fs::canonicalize(root).await.map_err(|error| {
        invalid_path(label, format!("could not resolve authorized root: {error}"))
    })?;
    if !same_canonical_path(root, &canonical) {
        return Err(invalid_path(
            label,
            "authorized root changed after it was resolved",
        ));
    }
    Ok(canonical)
}

#[cfg(windows)]
fn same_canonical_path(left: &Path, right: &Path) -> bool {
    left.as_os_str()
        .to_string_lossy()
        .eq_ignore_ascii_case(&right.as_os_str().to_string_lossy())
}

#[cfg(not(windows))]
fn same_canonical_path(left: &Path, right: &Path) -> bool {
    left == right
}

async fn inspect_child_components(
    root: &Path,
    relative: &Path,
    label: &str,
) -> Result<(), ApiCommandError> {
    let components = relative.components().collect::<Vec<_>>();
    let mut current = root.to_path_buf();
    for (index, component) in components.iter().enumerate() {
        let Component::Normal(segment) = component else {
            return Err(invalid_path(label, "contains an unsafe path component"));
        };
        current.push(segment);
        match fs::symlink_metadata(&current).await {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(invalid_path(label, "contains a symbolic link"));
            }
            Ok(metadata) if index + 1 < components.len() && !metadata.is_dir() => {
                return Err(invalid_path(
                    label,
                    "contains a non-directory parent component",
                ));
            }
            Ok(metadata)
                if index + 1 == components.len() && !metadata.is_file() && !metadata.is_dir() =>
            {
                return Err(invalid_path(
                    label,
                    "does not resolve to a regular file or directory",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => {
                return Err(invalid_path(
                    label,
                    format!("could not inspect child path: {error}"),
                ))
            }
        }
    }
    Ok(())
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
fn validate_windows_component(value: &std::ffi::OsStr, label: &str) -> Result<(), ApiCommandError> {
    let value = value
        .to_str()
        .ok_or_else(|| invalid_path(label, "must be valid UTF-8"))?;
    if value.contains(':') || value.ends_with(' ') || value.ends_with('.') {
        return Err(invalid_path(
            label,
            "contains a Windows-unsafe path component",
        ));
    }
    let stem = value
        .split('.')
        .next()
        .unwrap_or(value)
        .trim_end_matches([' ', '.'])
        .to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem.strip_prefix("COM").is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
        || stem.strip_prefix("LPT").is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        })
    {
        return Err(invalid_path(
            label,
            "contains a reserved Windows device name",
        ));
    }
    Ok(())
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
    use std::time::{SystemTime, UNIX_EPOCH};

    use tokio::fs;

    use super::{absolute_path, canonical_root, checked_child_output_file, safe_relative_path};

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

    #[test]
    fn rejects_unsafe_relative_paths() {
        assert!(safe_relative_path("folder/file.txt", "Path").is_ok());
        assert!(safe_relative_path("", "Path").is_err());
        assert!(safe_relative_path("../file.txt", "Path").is_err());
        assert!(safe_relative_path("folder/../file.txt", "Path").is_err());
        assert!(safe_relative_path("/absolute.txt", "Path").is_err());
        #[cfg(windows)]
        {
            assert!(safe_relative_path(r"folder\file.txt", "Path").is_err());
            assert!(safe_relative_path("folder/file.txt:stream", "Path").is_err());
            assert!(safe_relative_path("CON.txt", "Path").is_err());
        }
    }

    #[tokio::test]
    async fn rejects_noncanonical_authorized_root() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "discloud-path-security-{}-{nonce}",
            std::process::id()
        ));
        let root = base.join("root");
        fs::create_dir_all(&root).await.unwrap();
        let canonical = fs::canonicalize(&root).await.unwrap();
        let alias = root.join("..").join("root");

        assert!(canonical_root(&canonical, "Root").await.is_ok());
        assert!(canonical_root(&alias, "Root").await.is_err());

        let _ = fs::remove_dir_all(base).await;
    }

    #[tokio::test]
    async fn rejects_non_directory_child_parent() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "discloud-path-security-child-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&base).await.unwrap();
        let root = fs::canonicalize(&base).await.unwrap();
        fs::write(root.join("parent"), b"file").await.unwrap();

        assert!(
            checked_child_output_file(&root, "parent/child.txt", "Child")
                .await
                .is_err()
        );

        let _ = fs::remove_dir_all(base).await;
    }
}
