use std::{
    collections::{HashMap, HashSet, VecDeque},
    io::SeekFrom,
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
    time::Duration,
};

use reqwest::Method;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::{
    fs::{self, File},
    io::{AsyncReadExt, AsyncSeekExt},
    sync::{mpsc, watch, Semaphore},
    time::sleep,
};

use crate::api::{response_error, ApiCommandError, ApiState};

const MAX_PART_ATTEMPTS: usize = 3;

#[derive(Clone, Default)]
pub(crate) struct UploadTransferState {
    tasks: Arc<RwLock<HashMap<String, watch::Sender<bool>>>>,
}

#[derive(Clone)]
pub(crate) struct LocalUploadFile {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) size: u64,
    pub(crate) relative_path: String,
}

pub(crate) struct UploadPartResult {
    size: u64,
}

pub(crate) struct UploadRunInput {
    pub(crate) task_id: String,
    pub(crate) upload_id: Option<String>,
    pub(crate) folder_id: String,
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) size: u64,
}

#[derive(Clone)]
pub(crate) struct UploadTransferEvent {
    pub(crate) status: &'static str,
    pub(crate) session_id: String,
    pub(crate) uploaded_bytes: u64,
}

pub(crate) struct UploadRunResult {
    pub(crate) session_id: String,
    pub(crate) uploaded_bytes: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadSession {
    id: String,
    parent_folder_id: String,
    size: u64,
    chunk_size: u64,
    expected_parts: usize,
    recommended_part_concurrency: usize,
    status: String,
    #[serde(default)]
    parts: Vec<UploadSessionPart>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadSessionPart {
    part_index: u32,
    size: u64,
}

struct UploadPartPlan {
    index: u32,
    offset: u64,
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
    let mut files = Vec::new();

    for source in paths {
        let path = PathBuf::from(source);
        let metadata = fs::symlink_metadata(&path).await.map_err(|error| {
            ApiCommandError::invalid_request(format!(
                "Could not read upload path metadata: {error}"
            ))
        })?;

        reject_symlink(&path, &metadata)?;

        let name = path_name(&path)?;

        if metadata.is_file() {
            push_local_file(&mut files, &path, name.clone(), metadata.len(), name)?;
        } else if metadata.is_dir() {
            inspect_directory(&path, name, &mut files).await?;
        } else {
            return Err(ApiCommandError::invalid_request(format!(
                "Unsupported upload path: {}",
                path.display()
            )));
        }
    }

    Ok(files)
}

pub(crate) async fn run_upload_task<F>(
    api: &ApiState,
    transfers: &UploadTransferState,
    input: UploadRunInput,
    mut on_progress: F,
) -> Result<UploadRunResult, ApiCommandError>
where
    F: FnMut(UploadTransferEvent),
{
    if !valid_resource_id(&input.folder_id) {
        return Err(ApiCommandError::invalid_request("Invalid folder ID."));
    }

    if input.name.trim().is_empty() {
        return Err(ApiCommandError::invalid_request(
            "Upload file name is required.",
        ));
    }

    let mut cancellation = transfers.subscribe(&input.task_id)?;

    if *cancellation.borrow() {
        return Err(ApiCommandError::cancelled());
    }

    let session = match input.upload_id.as_deref() {
        Some(upload_id) => get_upload_session(api, &mut cancellation, upload_id).await?,
        None => {
            create_upload_session(
                api,
                &mut cancellation,
                &input.folder_id,
                &input.name,
                input.size,
            )
            .await?
        }
    };

    publish_upload_event(&mut on_progress, "uploading", &session.id, 0);

    if session.parent_folder_id != input.folder_id || session.size != input.size {
        return Err(ApiCommandError::invalid_response(
            "Upload session no longer matches this file.",
        ));
    }

    if session.status == "completed" {
        return Ok(UploadRunResult {
            session_id: session.id,
            uploaded_bytes: input.size,
        });
    }

    if session.status != "open" {
        return Err(ApiCommandError::invalid_response(format!(
            "Upload session is {}.",
            session.status
        )));
    }

    let plan = plan_upload_parts(input.size, session.chunk_size)?;

    if plan.len() != session.expected_parts {
        return Err(ApiCommandError::invalid_response(
            "Upload session part count is inconsistent.",
        ));
    }

    let uploaded_parts = session
        .parts
        .iter()
        .map(|part| part.part_index)
        .collect::<HashSet<_>>();
    let mut uploaded_bytes = session.parts.iter().try_fold(0u64, |total, part| {
        total
            .checked_add(part.size)
            .ok_or_else(|| ApiCommandError::invalid_response("Upload progress overflowed."))
    })?;

    publish_upload_event(
        &mut on_progress,
        "uploading",
        &session.id,
        uploaded_bytes.min(input.size),
    );

    let missing = plan
        .into_iter()
        .filter(|part| !uploaded_parts.contains(&part.index))
        .collect::<Vec<_>>();

    if !missing.is_empty() {
        let concurrency = session
            .recommended_part_concurrency
            .max(1)
            .min(missing.len());
        let expected = missing.len();
        let semaphore = Arc::new(Semaphore::new(concurrency));
        let (sender, mut receiver) = mpsc::channel(concurrency);
        let api = ApiState::clone(api);
        let transfers = UploadTransferState::clone(transfers);

        for part in missing {
            let semaphore = Arc::clone(&semaphore);
            let sender = sender.clone();
            let api = api.clone();
            let transfers = transfers.clone();
            let task_id = input.task_id.clone();
            let upload_id = session.id.clone();
            let path = input.path.clone();

            tauri::async_runtime::spawn(async move {
                let result = match semaphore.acquire_owned().await {
                    Ok(_permit) => {
                        upload_part(
                            &api,
                            &transfers,
                            task_id,
                            upload_id,
                            path,
                            part.index,
                            part.offset,
                            part.size,
                        )
                        .await
                    }
                    Err(_) => Err(ApiCommandError::internal(
                        "Upload concurrency controller was closed.",
                    )),
                };

                let _ = sender.send(result).await;
            });
        }

        drop(sender);

        let mut completed = 0usize;

        while let Some(result) = receiver.recv().await {
            let result = match result {
                Ok(result) => result,
                Err(error) => {
                    let _ = transfers.cancel(&input.task_id);
                    return Err(error);
                }
            };

            completed += 1;
            uploaded_bytes = uploaded_bytes
                .checked_add(result.size)
                .ok_or_else(|| ApiCommandError::invalid_response("Upload progress overflowed."))?;

            publish_upload_event(
                &mut on_progress,
                "uploading",
                &session.id,
                uploaded_bytes.min(input.size),
            );
        }

        if completed != expected {
            let _ = transfers.cancel(&input.task_id);
            return Err(ApiCommandError::internal(
                "Upload workers stopped before all parts completed.",
            ));
        }
    }

    if *cancellation.borrow() {
        return Err(ApiCommandError::cancelled());
    }

    publish_upload_event(&mut on_progress, "finalizing", &session.id, input.size);
    complete_upload_session(api, &mut cancellation, &session.id).await?;

    Ok(UploadRunResult {
        session_id: session.id,
        uploaded_bytes: input.size,
    })
}

pub(crate) async fn cancel_upload(api: &ApiState, upload_id: &str) -> Result<(), ApiCommandError> {
    if !valid_resource_id(upload_id) {
        return Err(ApiCommandError::invalid_request("Invalid upload ID."));
    }

    let path = format!("/api/v1/uploads/{upload_id}");
    api.request_empty(Method::DELETE, path, None).await
}

async fn upload_part(
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

async fn create_upload_session(
    api: &ApiState,
    cancellation: &mut watch::Receiver<bool>,
    folder_id: &str,
    name: &str,
    size: u64,
) -> Result<UploadSession, ApiCommandError> {
    let request = api.request_json(
        Method::POST,
        "/api/v1/uploads".to_string(),
        Some(json!({
            "parentFolderId": folder_id,
            "name": name,
            "size": size,
        })),
    );

    tokio::select! {
        _ = wait_for_cancel(cancellation) => Err(ApiCommandError::cancelled()),
        result = request => result,
    }
}

async fn get_upload_session(
    api: &ApiState,
    cancellation: &mut watch::Receiver<bool>,
    upload_id: &str,
) -> Result<UploadSession, ApiCommandError> {
    if !valid_resource_id(upload_id) {
        return Err(ApiCommandError::invalid_request("Invalid upload ID."));
    }

    let request = api.request_json(Method::GET, format!("/api/v1/uploads/{upload_id}"), None);

    tokio::select! {
        _ = wait_for_cancel(cancellation) => Err(ApiCommandError::cancelled()),
        result = request => result,
    }
}

async fn complete_upload_session(
    api: &ApiState,
    cancellation: &mut watch::Receiver<bool>,
    upload_id: &str,
) -> Result<(), ApiCommandError> {
    if !valid_resource_id(upload_id) {
        return Err(ApiCommandError::invalid_request("Invalid upload ID."));
    }

    let request = api.request_empty(
        Method::POST,
        format!("/api/v1/uploads/{upload_id}/complete"),
        None,
    );

    tokio::select! {
        _ = wait_for_cancel(cancellation) => Err(ApiCommandError::cancelled()),
        result = request => result,
    }
}

fn publish_upload_event<F>(
    on_progress: &mut F,
    status: &'static str,
    session_id: &str,
    uploaded_bytes: u64,
) where
    F: FnMut(UploadTransferEvent),
{
    on_progress(UploadTransferEvent {
        status,
        session_id: session_id.to_string(),
        uploaded_bytes,
    });
}

fn plan_upload_parts(size: u64, chunk_size: u64) -> Result<Vec<UploadPartPlan>, ApiCommandError> {
    if chunk_size == 0 {
        return Err(ApiCommandError::invalid_response(
            "Upload session chunk size is invalid.",
        ));
    }

    if size == 0 {
        return Ok(Vec::new());
    }

    let mut parts = Vec::new();
    let mut offset = 0u64;
    let mut index = 0u32;

    while offset < size {
        let part_size = chunk_size.min(size - offset);
        parts.push(UploadPartPlan {
            index,
            offset,
            size: part_size,
        });
        offset = offset
            .checked_add(part_size)
            .ok_or_else(|| ApiCommandError::invalid_response("Upload part range overflowed."))?;
        index = index
            .checked_add(1)
            .ok_or_else(|| ApiCommandError::invalid_response("Upload has too many parts."))?;
    }

    Ok(parts)
}

async fn inspect_directory(
    root: &Path,
    root_name: String,
    files: &mut Vec<LocalUploadFile>,
) -> Result<(), ApiCommandError> {
    let mut directories = VecDeque::from([(root.to_path_buf(), root_name)]);

    while let Some((directory, relative_directory)) = directories.pop_front() {
        let mut reader = fs::read_dir(&directory).await.map_err(|error| {
            ApiCommandError::invalid_request(format!(
                "Could not read upload directory {}: {error}",
                directory.display()
            ))
        })?;
        let mut entries = Vec::new();

        while let Some(entry) = reader.next_entry().await.map_err(|error| {
            ApiCommandError::invalid_request(format!(
                "Could not read upload directory entry: {error}"
            ))
        })? {
            let name = entry.file_name().into_string().map_err(|_| {
                ApiCommandError::invalid_request("Upload path contains a non-Unicode file name.")
            })?;

            entries.push((name, entry.path()));
        }

        entries.sort_by(|left, right| left.0.cmp(&right.0));

        for (name, path) in entries {
            let metadata = fs::symlink_metadata(&path).await.map_err(|error| {
                ApiCommandError::invalid_request(format!(
                    "Could not read upload path metadata: {error}"
                ))
            })?;

            reject_symlink(&path, &metadata)?;

            let relative_path = join_relative_path(&relative_directory, &name);

            if metadata.is_file() {
                push_local_file(files, &path, name, metadata.len(), relative_path)?;
            } else if metadata.is_dir() {
                directories.push_back((path, relative_path));
            } else {
                return Err(ApiCommandError::invalid_request(format!(
                    "Unsupported upload path: {}",
                    path.display()
                )));
            }
        }
    }

    Ok(())
}

fn push_local_file(
    files: &mut Vec<LocalUploadFile>,
    path: &Path,
    name: String,
    size: u64,
    relative_path: String,
) -> Result<(), ApiCommandError> {
    let path = path
        .to_str()
        .ok_or_else(|| {
            ApiCommandError::invalid_request("Upload path contains non-Unicode characters.")
        })?
        .to_string();

    files.push(LocalUploadFile {
        path,
        name,
        size,
        relative_path,
    });

    Ok(())
}

fn path_name(path: &Path) -> Result<String, ApiCommandError> {
    path.file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| ApiCommandError::invalid_request("Upload path name is invalid."))
}

fn reject_symlink(path: &Path, metadata: &std::fs::Metadata) -> Result<(), ApiCommandError> {
    if metadata.file_type().is_symlink() {
        return Err(ApiCommandError::invalid_request(format!(
            "Symbolic links cannot be uploaded: {}",
            path.display()
        )));
    }

    Ok(())
}

fn join_relative_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
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
                ApiCommandError::internal(format!(
                    "Could not read upload file: {error}"
                ))
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
    use super::{join_relative_path, plan_upload_parts, sha256_hex, validate_part_range};

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

    #[test]
    fn plans_upload_parts() {
        let parts = plan_upload_parts(11, 5).unwrap();

        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0].index, 0);
        assert_eq!(parts[0].offset, 0);
        assert_eq!(parts[0].size, 5);
        assert_eq!(parts[2].index, 2);
        assert_eq!(parts[2].offset, 10);
        assert_eq!(parts[2].size, 1);
    }

    #[test]
    fn joins_relative_upload_paths() {
        assert_eq!(
            join_relative_path("folder/subfolder", "file.txt"),
            "folder/subfolder/file.txt",
        );
    }
}
