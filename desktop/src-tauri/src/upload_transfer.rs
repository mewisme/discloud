use std::{collections::HashMap, io::SeekFrom, path::Path, sync::RwLock, time::Duration};

use reqwest::Method;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt},
    sync::watch,
    time::sleep,
};

use crate::api::{response_error, ApiCommandError, ApiState};

const MAX_PART_ATTEMPTS: usize = 3;

#[derive(Default)]
pub(crate) struct UploadTransferState {
    tasks: RwLock<HashMap<String, watch::Sender<bool>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUploadFile {
    path: String,
    name: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UploadPartResult {
    size: u64,
}

impl UploadTransferState {
    pub(crate) fn begin(&self, task_id: String) -> Result<(), ApiCommandError> {
        if task_id.trim().is_empty() {
            return Err(ApiCommandError::invalid_request(
                "Upload task ID is required.",
            ));
        }

        let (sender, _) = watch::channel(false);
        let mut tasks = self
            .tasks
            .write()
            .map_err(|_| ApiCommandError::internal("Upload state lock is poisoned."))?;

        if let Some(previous) = tasks.insert(task_id, sender) {
            let _ = previous.send(true);
        }

        Ok(())
    }

    pub(crate) fn cancel(&self, task_id: &str) -> Result<bool, ApiCommandError> {
        let tasks = self
            .tasks
            .read()
            .map_err(|_| ApiCommandError::internal("Upload state lock is poisoned."))?;

        let Some(sender) = tasks.get(task_id) else {
            return Ok(false);
        };

        let _ = sender.send(true);
        Ok(true)
    }

    pub(crate) fn finish(&self, task_id: &str) -> Result<(), ApiCommandError> {
        self.tasks
            .write()
            .map_err(|_| ApiCommandError::internal("Upload state lock is poisoned."))?
            .remove(task_id);

        Ok(())
    }

    fn subscribe(&self, task_id: &str) -> Result<watch::Receiver<bool>, ApiCommandError> {
        self.tasks
            .read()
            .map_err(|_| ApiCommandError::internal("Upload state lock is poisoned."))?
            .get(task_id)
            .map(watch::Sender::subscribe)
            .ok_or_else(|| ApiCommandError::invalid_request("Upload task is not active."))
    }
}

pub(crate) async fn inspect_files(
    paths: Vec<String>,
) -> Result<Vec<LocalUploadFile>, ApiCommandError> {
    let mut files = Vec::with_capacity(paths.len());

    for path in paths {
        let metadata = tokio::fs::metadata(&path).await.map_err(|error| {
            ApiCommandError::invalid_request(format!(
                "Could not read upload file metadata: {error}"
            ))
        })?;

        if !metadata.is_file() {
            return Err(ApiCommandError::invalid_request(format!(
                "{} is not a file.",
                path
            )));
        }

        let name = Path::new(&path)
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| ApiCommandError::invalid_request("Upload file name is invalid."))?
            .to_string();

        files.push(LocalUploadFile {
            path,
            name,
            size: metadata.len(),
        });
    }

    Ok(files)
}

pub(crate) async fn upload_part(
    api: &ApiState,
    transfers: &UploadTransferState,
    task_id: String,
    upload_id: String,
    path: String,
    part_index: u32,
    offset: u64,
    size: u64,
) -> Result<UploadPartResult, ApiCommandError> {
    if !valid_resource_id(&upload_id) {
        return Err(ApiCommandError::invalid_request("Invalid upload ID."));
    }

    let mut cancellation = transfers.subscribe(&task_id)?;

    if *cancellation.borrow() {
        return Err(ApiCommandError::cancelled());
    }

    let body = read_part(&path, offset, size, &mut cancellation).await?;
    let sha256 = sha256_hex(&body);
    let endpoint = format!("/api/v1/uploads/{upload_id}/parts/{part_index}");
    let headers = vec![
        (
            "Content-Type".to_string(),
            "application/octet-stream".to_string(),
        ),
        ("X-Chunk-SHA256".to_string(), sha256),
    ];

    for attempt in 0..MAX_PART_ATTEMPTS {
        if *cancellation.borrow() {
            return Err(ApiCommandError::cancelled());
        }

        let request = api.raw_request_body(
            Method::PUT,
            &endpoint,
            Vec::new(),
            headers.clone(),
            body.clone(),
        );

        let response = tokio::select! {
            _ = wait_for_cancel(&mut cancellation) => {
                return Err(ApiCommandError::cancelled());
            }

            result = request => result,
        };

        match response {
            Ok(response) if response.status().is_success() => {
                let _ = response.bytes().await;
                return Ok(UploadPartResult { size });
            }

            Ok(response) => {
                let error = response_error(response).await;

                if attempt + 1 >= MAX_PART_ATTEMPTS || !error.is_retryable_transfer() {
                    return Err(error);
                }
            }

            Err(error) => {
                if attempt + 1 >= MAX_PART_ATTEMPTS || !error.is_retryable_transfer() {
                    return Err(error);
                }
            }
        }

        retry_delay(attempt, &mut cancellation).await?;
    }

    Err(ApiCommandError::internal(
        "Upload part retry loop exited unexpectedly.",
    ))
}

async fn read_part(
    path: &str,
    offset: u64,
    size: u64,
    cancellation: &mut watch::Receiver<bool>,
) -> Result<Vec<u8>, ApiCommandError> {
    let mut file = File::open(path).await.map_err(|error| {
        ApiCommandError::invalid_request(format!("Could not open upload file: {error}"))
    })?;

    let metadata = file.metadata().await.map_err(|error| {
        ApiCommandError::invalid_request(format!("Could not read upload file metadata: {error}"))
    })?;

    validate_part_range(metadata.len(), offset, size)?;

    file.seek(SeekFrom::Start(offset)).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not seek upload file: {error}"))
    })?;

    let length = usize::try_from(size).map_err(|_| {
        ApiCommandError::invalid_request("Upload part is too large for this platform.")
    })?;
    let mut body = vec![0u8; length];

    tokio::select! {
        _ = wait_for_cancel(cancellation) => {
            return Err(ApiCommandError::cancelled());
        }

        result = file.read_exact(&mut body) => {
            result.map_err(|error| {
                ApiCommandError::internal(format!("Could not read upload file: {error}"))
            })?;
        }
    }

    Ok(body)
}

async fn retry_delay(
    attempt: usize,
    cancellation: &mut watch::Receiver<bool>,
) -> Result<(), ApiCommandError> {
    let delay = Duration::from_millis(500 * 2_u64.pow(attempt as u32));

    tokio::select! {
        _ = sleep(delay) => Ok(()),
        _ = wait_for_cancel(cancellation) => Err(ApiCommandError::cancelled()),
    }
}

async fn wait_for_cancel(receiver: &mut watch::Receiver<bool>) {
    if *receiver.borrow() {
        return;
    }

    loop {
        if receiver.changed().await.is_err() {
            return;
        }

        if *receiver.borrow_and_update() {
            return;
        }
    }
}

fn sha256_hex(body: &[u8]) -> String {
    Sha256::digest(body)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn validate_part_range(file_size: u64, offset: u64, size: u64) -> Result<(), ApiCommandError> {
    let Some(end) = offset.checked_add(size) else {
        return Err(ApiCommandError::invalid_request(
            "Upload part range overflows.",
        ));
    };

    if size == 0 || offset > file_size || end > file_size {
        return Err(ApiCommandError::invalid_request(
            "Upload part range is outside the local file.",
        ));
    }

    Ok(())
}

fn valid_resource_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'-' || value == b'_')
}

#[cfg(test)]
mod tests {
    use super::{sha256_hex, validate_part_range};

    #[test]
    fn hashes_upload_part() {
        assert_eq!(
            sha256_hex(b"hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        );
    }

    #[test]
    fn validates_part_range() {
        assert!(validate_part_range(100, 0, 50).is_ok());
        assert!(validate_part_range(100, 50, 50).is_ok());
        assert!(validate_part_range(100, 99, 2).is_err());
        assert!(validate_part_range(100, 0, 0).is_err());
    }
}
