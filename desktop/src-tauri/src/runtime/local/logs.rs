use std::{io::SeekFrom, path::Path};

use serde::{Deserialize, Serialize};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
};

use super::{layout::LocalRuntimeLayout, LocalRuntimeError};

const LOG_TAIL_BYTES: u64 = 64 * 1024;
const PROVISIONING_LOG: &str = "provisioning.log";

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum LocalRuntimeLogStage {
    Prepare,
    PostgresqlRuntime,
    Database,
    Backend,
    Web,
    Connect,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalRuntimeLog {
    content: String,
    truncated: bool,
}

impl LocalRuntimeLogStage {
    fn key(self) -> &'static str {
        match self {
            Self::Prepare => "prepare",
            Self::PostgresqlRuntime => "postgresqlRuntime",
            Self::Database => "database",
            Self::Backend => "backend",
            Self::Web => "web",
            Self::Connect => "connect",
        }
    }

    fn process_log(
        self,
        layout: &LocalRuntimeLayout,
    ) -> Option<(&'static str, std::path::PathBuf)> {
        match self {
            Self::Database => Some(("postgresql.log", layout.logs_dir.join("postgresql.log"))),
            Self::Backend => Some(("backend.log", layout.logs_dir.join("backend.log"))),
            Self::Web => Some(("web.log", layout.logs_dir.join("web.log"))),
            _ => None,
        }
    }
}

pub(super) async fn reset(layout: &LocalRuntimeLayout) {
    let path = layout.logs_dir.join(PROVISIONING_LOG);
    if let Err(error) = fs::create_dir_all(&layout.logs_dir).await {
        crate::diagnostics::warn(
            "runtime.local.logs",
            format!("could not prepare {}: {error}", layout.logs_dir.display()),
        );
        return;
    }
    if let Err(error) = fs::write(&path, b"").await {
        crate::diagnostics::warn(
            "runtime.local.logs",
            format!("could not reset {}: {error}", path.display()),
        );
    }
}

pub(super) async fn append(
    layout: &LocalRuntimeLayout,
    stage: LocalRuntimeLogStage,
    message: impl AsRef<str>,
) {
    if let Err(error) = append_inner(layout, stage, message.as_ref()).await {
        crate::diagnostics::warn("runtime.local.logs", error.message().to_string());
    }
}

pub(super) async fn read(
    layout: &LocalRuntimeLayout,
    stage: LocalRuntimeLogStage,
) -> Result<LocalRuntimeLog, LocalRuntimeError> {
    let provisioning = read_tail(&layout.logs_dir.join(PROVISIONING_LOG)).await?;
    let prefix = format!("{}\t", stage.key());
    let lifecycle = provisioning
        .content
        .lines()
        .filter_map(|line| line.strip_prefix(&prefix))
        .map(|line| format!("[runtime] {line}"))
        .collect::<Vec<_>>()
        .join("\n");
    let mut content = lifecycle;
    let mut truncated = provisioning.truncated;
    if !content.is_empty() {
        if let Some((name, path)) = stage.process_log(layout) {
            let process = read_tail(&path).await?;
            truncated |= process.truncated;
            if !process.content.trim().is_empty() {
                if !content.is_empty() {
                    content.push_str("\n\n");
                }
                content.push_str(&format!("--- {name} ---\n{}", process.content.trim_end()));
            }
        }
    }
    Ok(LocalRuntimeLog { content, truncated })
}

async fn append_inner(
    layout: &LocalRuntimeLayout,
    stage: LocalRuntimeLogStage,
    message: &str,
) -> Result<(), LocalRuntimeError> {
    let path = layout.logs_dir.join(PROVISIONING_LOG);
    fs::create_dir_all(&layout.logs_dir)
        .await
        .map_err(|error| {
            LocalRuntimeError::io("Could not create the local runtime log directory", error)
        })?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .await
        .map_err(|error| {
            LocalRuntimeError::io("Could not open the local provisioning log", error)
        })?;
    let message = message.replace('\r', " ").replace('\n', " ");
    file.write_all(format!("{}\t{message}\n", stage.key()).as_bytes())
        .await
        .map_err(|error| LocalRuntimeError::io("Could not write the local provisioning log", error))
}

async fn read_tail(path: &Path) -> Result<LocalRuntimeLog, LocalRuntimeError> {
    let mut file = match fs::File::open(path).await {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(LocalRuntimeLog {
                content: String::new(),
                truncated: false,
            })
        }
        Err(error) => {
            return Err(LocalRuntimeError::io(
                "Could not open a local runtime log",
                error,
            ))
        }
    };
    let size = file
        .metadata()
        .await
        .map_err(|error| LocalRuntimeError::io("Could not inspect a local runtime log", error))?
        .len();
    let start = size.saturating_sub(LOG_TAIL_BYTES);
    if start > 0 {
        file.seek(SeekFrom::Start(start))
            .await
            .map_err(|error| LocalRuntimeError::io("Could not seek a local runtime log", error))?;
    }
    let mut bytes = Vec::with_capacity((size - start) as usize);
    file.read_to_end(&mut bytes)
        .await
        .map_err(|error| LocalRuntimeError::io("Could not read a local runtime log", error))?;
    let mut content = String::from_utf8_lossy(&bytes).into_owned();
    if start > 0 {
        if let Some(index) = content.find('\n') {
            content.drain(..=index);
        }
    }
    Ok(LocalRuntimeLog {
        content,
        truncated: start > 0,
    })
}
