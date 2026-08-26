use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use tokio::{fs, io::AsyncWriteExt};

use super::LocalRuntimeError;

pub(super) async fn write(
    path: &Path,
    content: impl AsRef<[u8]>,
    context: &'static str,
) -> Result<(), LocalRuntimeError> {
    let temporary = temporary_path(path);
    let result = async {
        let mut file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temporary)
            .await
            .map_err(|error| LocalRuntimeError::io(context, error))?;
        file.write_all(content.as_ref())
            .await
            .map_err(|error| LocalRuntimeError::io(context, error))?;
        file.sync_all()
            .await
            .map_err(|error| LocalRuntimeError::io(context, error))?;
        drop(file);
        replace(&temporary, path, context).await
    }
    .await;
    if result.is_err() {
        let _ = fs::remove_file(&temporary).await;
    }
    result
}

fn temporary_path(path: &Path) -> PathBuf {
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(
        ".{}.{}.tmp",
        std::process::id(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    ));
    PathBuf::from(name)
}

#[cfg(not(target_os = "windows"))]
pub(super) async fn replace(
    source: &Path,
    destination: &Path,
    context: &'static str,
) -> Result<(), LocalRuntimeError> {
    fs::rename(source, destination)
        .await
        .map_err(|error| LocalRuntimeError::io(context, error))
}

#[cfg(target_os = "windows")]
pub(super) async fn replace(
    source: &Path,
    destination: &Path,
    context: &'static str,
) -> Result<(), LocalRuntimeError> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        },
    };

    let mut source = source.as_os_str().encode_wide().collect::<Vec<_>>();
    let mut destination = destination.as_os_str().encode_wide().collect::<Vec<_>>();
    source.push(0);
    destination.push(0);
    unsafe {
        MoveFileExW(
            PCWSTR(source.as_ptr()),
            PCWSTR(destination.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
    .map_err(|error| LocalRuntimeError::io(context, error))
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use tokio::fs;

    use super::write;

    #[tokio::test]
    async fn replaces_existing_file() {
        let id = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock is before the Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("discloud-atomic-file-{id}"));
        let path = directory.join("state.json");
        fs::create_dir_all(&directory)
            .await
            .expect("create test directory");
        fs::write(&path, b"old").await.expect("write initial file");
        write(&path, b"new", "replace test file")
            .await
            .expect("replace existing file");
        assert_eq!(fs::read(&path).await.expect("read replaced file"), b"new");
        fs::remove_dir_all(directory)
            .await
            .expect("remove test directory");
    }
}
