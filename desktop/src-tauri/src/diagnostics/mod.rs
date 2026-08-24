use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::api::ApiCommandError;

const LOG_FILE_NAME: &str = "discloud-desktop.log";
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
const MAX_ARCHIVES: usize = 3;
const TAIL_BYTES: u64 = 64 * 1024;
const MAX_MESSAGE_CHARS: usize = 8192;

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static LOG_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopDiagnostics {
    directory: String,
    files: Vec<DesktopLogFile>,
    total_size: u64,
    tail: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopLogFile {
    name: String,
    size: u64,
}

pub(crate) fn setup(app: &AppHandle) {
    let directory = match app.path().app_log_dir() {
        Ok(directory) => directory,
        Err(error) => {
            eprintln!("DisCloud desktop diagnostics: could not resolve log directory: {error}");
            return;
        }
    };
    if let Err(error) = fs::create_dir_all(&directory) {
        eprintln!("DisCloud desktop diagnostics: could not create log directory: {error}");
        return;
    }
    let _ = LOG_DIR.set(directory);
    info(
        "runtime",
        format!("start version={}", env!("CARGO_PKG_VERSION")),
    );
}

pub(crate) fn info(scope: &str, message: impl AsRef<str>) {
    record("INFO", scope, message.as_ref());
}

pub(crate) fn warn(scope: &str, message: impl AsRef<str>) {
    record("WARN", scope, message.as_ref());
}

pub(crate) fn error(scope: &str, message: impl AsRef<str>) {
    record("ERROR", scope, message.as_ref());
}

fn record(level: &str, scope: &str, message: &str) {
    let Some(directory) = LOG_DIR.get() else {
        eprintln!("DisCloud desktop [{level}] [{scope}] {message}");
        return;
    };
    let Ok(_guard) = LOG_LOCK.lock() else {
        eprintln!("DisCloud desktop diagnostics: log lock is poisoned");
        return;
    };
    if fs::create_dir_all(directory).is_err() {
        return;
    }
    let path = directory.join(LOG_FILE_NAME);
    if rotate_if_needed(&path).is_err() {
        return;
    }
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let scope = sanitize(scope);
    let message = sanitize(message);
    let _ = writeln!(file, "{timestamp}	{level}	{scope}	{message}");
}

fn sanitize(value: &str) -> String {
    let redacted = redact_urls(value);
    let mut output = String::new();
    for character in redacted.chars().take(MAX_MESSAGE_CHARS) {
        match character {
            '\r' => output.push_str("\\r"),
            '\n' => output.push_str("\\n"),
            '\t' => output.push(' '),
            character => output.push(character),
        }
    }
    output
}

fn redact_urls(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = String::with_capacity(value.len());
    let mut index = 0usize;
    while index < bytes.len() {
        let rest = &value[index..];
        let prefix_len = if rest.starts_with("https://") {
            Some(8usize)
        } else if rest.starts_with("http://") {
            Some(7usize)
        } else {
            None
        };
        if let Some(prefix_len) = prefix_len {
            output.push_str("[url]");
            index += prefix_len;
            while index < bytes.len() {
                let byte = bytes[index];
                if byte.is_ascii_whitespace() || matches!(byte, b')' | b']' | b'}' | b'"' | b'\'') {
                    break;
                }
                index += 1;
            }
            continue;
        }
        let character = rest.chars().next().expect("non-empty string slice");
        output.push(character);
        index += character.len_utf8();
    }
    output
}

fn rotate_if_needed(path: &Path) -> std::io::Result<()> {
    if fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
        < MAX_LOG_BYTES
    {
        return Ok(());
    }
    for index in (1..=MAX_ARCHIVES).rev() {
        let destination = archive_path(path, index);
        if destination.exists() {
            fs::remove_file(&destination)?;
        }
        let source = if index == 1 {
            path.to_path_buf()
        } else {
            archive_path(path, index - 1)
        };
        if source.exists() {
            fs::rename(source, destination)?;
        }
    }
    Ok(())
}

fn archive_path(path: &Path, index: usize) -> PathBuf {
    PathBuf::from(format!("{}.{}", path.to_string_lossy(), index))
}

fn directory() -> Result<&'static PathBuf, ApiCommandError> {
    LOG_DIR
        .get()
        .ok_or_else(|| ApiCommandError::internal("Desktop diagnostics are not initialized."))
}

fn log_paths(directory: &Path) -> Vec<PathBuf> {
    let current = directory.join(LOG_FILE_NAME);
    let mut paths = vec![current.clone()];
    for index in 1..=MAX_ARCHIVES {
        paths.push(archive_path(&current, index));
    }
    paths
}

fn read_tail(path: &Path) -> Result<String, ApiCommandError> {
    let mut file = File::open(path).map_err(|error| {
        ApiCommandError::internal(format!("Could not open desktop log: {error}"))
    })?;
    let length = file
        .metadata()
        .map_err(|error| {
            ApiCommandError::internal(format!("Could not inspect desktop log: {error}"))
        })?
        .len();
    let start = length.saturating_sub(TAIL_BYTES);
    file.seek(SeekFrom::Start(start)).map_err(|error| {
        ApiCommandError::internal(format!("Could not seek desktop log: {error}"))
    })?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|error| {
        ApiCommandError::internal(format!("Could not read desktop log: {error}"))
    })?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
pub(crate) fn get_desktop_diagnostics() -> Result<DesktopDiagnostics, ApiCommandError> {
    let directory = directory()?;
    let _guard = LOG_LOCK
        .lock()
        .map_err(|_| ApiCommandError::internal("Desktop diagnostics log lock is poisoned."))?;
    let mut files = Vec::new();
    let mut total_size = 0u64;
    let mut tail = String::new();
    for path in log_paths(directory) {
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let size = metadata.len();
        total_size = total_size.saturating_add(size);
        if tail.is_empty() {
            tail = read_tail(&path)?;
        }
        files.push(DesktopLogFile {
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default(),
            size,
        });
    }
    Ok(DesktopDiagnostics {
        directory: directory.to_string_lossy().into_owned(),
        files,
        total_size,
        tail,
    })
}

#[tauri::command]
pub(crate) fn clear_desktop_logs() -> Result<(), ApiCommandError> {
    let directory = directory()?;
    let _guard = LOG_LOCK
        .lock()
        .map_err(|_| ApiCommandError::internal("Desktop diagnostics log lock is poisoned."))?;
    for path in log_paths(directory) {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(ApiCommandError::internal(format!(
                    "Could not clear desktop logs: {error}"
                )))
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn export_desktop_logs(destination: String) -> Result<(), ApiCommandError> {
    let directory = directory()?;
    let destination = PathBuf::from(destination);
    if destination.as_os_str().is_empty() || destination.file_name().is_none() {
        return Err(ApiCommandError::invalid_request(
            "Log export destination must be a file path.",
        ));
    }
    let _guard = LOG_LOCK
        .lock()
        .map_err(|_| ApiCommandError::internal("Desktop diagnostics log lock is poisoned."))?;
    let managed = log_paths(directory);
    if managed.iter().any(|path| path == &destination) {
        return Err(ApiCommandError::invalid_request(
            "Choose an export destination outside the managed log files.",
        ));
    }
    let mut output = File::create(&destination).map_err(|error| {
        ApiCommandError::internal(format!("Could not create log export: {error}"))
    })?;
    let mut exported = 0usize;
    for path in managed.iter().rev() {
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy())
            .unwrap_or_default();
        writeln!(output, "===== {name} =====").map_err(|error| {
            ApiCommandError::internal(format!("Could not write log export: {error}"))
        })?;
        let mut input = File::open(path).map_err(|error| {
            ApiCommandError::internal(format!("Could not open desktop log for export: {error}"))
        })?;
        std::io::copy(&mut input, &mut output).map_err(|error| {
            ApiCommandError::internal(format!("Could not export desktop log: {error}"))
        })?;
        writeln!(output).map_err(|error| {
            ApiCommandError::internal(format!("Could not finalize log export: {error}"))
        })?;
        exported += 1;
    }
    if exported == 0 {
        writeln!(output, "No desktop logs are currently available.").map_err(|error| {
            ApiCommandError::internal(format!("Could not write empty log export: {error}"))
        })?;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn open_desktop_log_folder() -> Result<(), ApiCommandError> {
    let directory = directory()?;
    fs::create_dir_all(directory).map_err(|error| {
        ApiCommandError::internal(format!("Could not create desktop log directory: {error}"))
    })?;
    open_directory(directory)
}

#[cfg(target_os = "windows")]
fn open_directory(path: &Path) -> Result<(), ApiCommandError> {
    Command::new("explorer.exe")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            ApiCommandError::internal(format!("Could not open desktop log folder: {error}"))
        })
}

#[cfg(target_os = "macos")]
fn open_directory(path: &Path) -> Result<(), ApiCommandError> {
    Command::new("open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            ApiCommandError::internal(format!("Could not open desktop log folder: {error}"))
        })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_directory(path: &Path) -> Result<(), ApiCommandError> {
    Command::new("xdg-open")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| {
            ApiCommandError::internal(format!("Could not open desktop log folder: {error}"))
        })
}
