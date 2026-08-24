use std::{
    collections::HashSet,
    ffi::OsString,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use reqwest::{Client, Method, StatusCode, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    fs::{self, File, OpenOptions},
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom},
    sync::Notify,
    time::sleep,
};

use crate::{
    api::{response_error, ApiCommandError, ApiState},
    diagnostics,
};

const DIRECT_CHUNK_CONCURRENCY: usize = 4;
const DIRECT_CHUNK_RETRIES: usize = 3;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirectFileManifest {
    id: String,
    size: u64,
    chunk_size: u64,
    chunk_count: usize,
    chunk_window_size: usize,
    sha256: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirectChunk {
    index: usize,
    offset: u64,
    size: u64,
    sha256: String,
    url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirectChunkWindow {
    chunks: Vec<DirectChunk>,
    next_start: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirectFolderManifest {
    entries: Vec<DirectFolderEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirectFolderEntry {
    path: String,
    kind: String,
    file_id: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResumeState {
    file_id: String,
    size: u64,
    sha256: String,
    completed: Vec<usize>,
}

#[derive(Clone, Copy)]
pub(super) struct DirectDownloadProgress {
    pub(super) phase: super::DownloadTaskPhase,
    pub(super) downloaded_bytes: u64,
    pub(super) total_bytes: Option<u64>,
    pub(super) completed_chunks: usize,
    pub(super) total_chunks: Option<usize>,
}

pub(super) enum DirectDownloadError {
    Cancelled,
    Failed(ApiCommandError),
}
impl From<ApiCommandError> for DirectDownloadError {
    fn from(value: ApiCommandError) -> Self {
        Self::Failed(value)
    }
}

pub(super) async fn download_file_direct<F>(
    api: &ApiState,
    file_id: &str,
    collection_id: Option<&str>,
    destination: &Path,
    cancel: Option<(Arc<AtomicBool>, Arc<Notify>)>,
    mut progress: F,
) -> Result<u64, DirectDownloadError>
where
    F: FnMut(DirectDownloadProgress) -> Result<(), ApiCommandError>,
{
    progress(DirectDownloadProgress {
        phase: super::DownloadTaskPhase::Preparing,
        downloaded_bytes: 0,
        total_bytes: None,
        completed_chunks: 0,
        total_chunks: None,
    })?;
    let manifest = file_manifest(api, file_id, collection_id).await?;
    validate_file_manifest(&manifest, file_id)?;
    if manifest.sha256.is_empty() {
        diagnostics::warn(
            "download.direct",
            format!(
                "file_id={file_id} whole_file_sha256=missing resume=false chunk_integrity=true"
            ),
        );
    }
    diagnostics::info(
        "download.direct",
        format!(
            "start file_id={file_id} size={} chunk_count={} whole_file_sha256={}",
            manifest.size,
            manifest.chunk_count,
            if manifest.sha256.is_empty() {
                "missing"
            } else {
                "present"
            }
        ),
    );
    let (temporary, sidecar) = resume_paths(destination)?;
    let mut completed = if manifest.sha256.is_empty() {
        let _ = fs::remove_file(&sidecar).await;
        HashSet::new()
    } else {
        load_resume(&sidecar, &temporary, &manifest).await
    };
    let mut output = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&temporary)
        .await
        .map_err(|error| {
            ApiCommandError::internal(format!("Could not open partial download: {error}"))
        })?;
    output.set_len(manifest.size).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not size partial download: {error}"))
    })?;
    completed.retain(|index| *index < manifest.chunk_count);
    let mut downloaded = resume_completed_bytes(&completed, &manifest);
    progress(DirectDownloadProgress {
        phase: super::DownloadTaskPhase::Resuming,
        downloaded_bytes: downloaded,
        total_bytes: Some(manifest.size),
        completed_chunks: completed.len(),
        total_chunks: Some(manifest.chunk_count),
    })?;
    let mut next = 0usize;
    while next < manifest.chunk_count {
        ensure_not_cancelled(cancel.as_ref())?;
        progress(DirectDownloadProgress {
            phase: super::DownloadTaskPhase::Resolving,
            downloaded_bytes: downloaded,
            total_bytes: Some(manifest.size),
            completed_chunks: completed.len(),
            total_chunks: Some(manifest.chunk_count),
        })?;
        let window = chunk_window(
            api,
            file_id,
            collection_id,
            next,
            manifest.chunk_window_size.min(16),
            false,
        )
        .await?;
        if window.chunks.is_empty() {
            return Err(ApiCommandError::internal("Direct download chunk window is empty.").into());
        }
        progress(DirectDownloadProgress {
            phase: super::DownloadTaskPhase::Transferring,
            downloaded_bytes: downloaded,
            total_bytes: Some(manifest.size),
            completed_chunks: completed.len(),
            total_chunks: Some(manifest.chunk_count),
        })?;
        for group in window.chunks.chunks(DIRECT_CHUNK_CONCURRENCY) {
            ensure_not_cancelled(cancel.as_ref())?;
            let mut jobs = Vec::new();
            for chunk in group
                .iter()
                .filter(|chunk| !completed.contains(&chunk.index))
                .cloned()
            {
                let api = api.clone();
                let collection_id = collection_id.map(str::to_string);
                let cancel = cancel.clone();
                let task_file_id = file_id.to_string();
                jobs.push(tauri::async_runtime::spawn(async move {
                    download_chunk(&api, task_file_id, collection_id, chunk, cancel).await
                }));
            }
            for job in jobs {
                let (chunk, bytes) = job.await.map_err(|error| {
                    ApiCommandError::internal(format!("Direct download task failed: {error}"))
                })??;
                output
                    .seek(SeekFrom::Start(chunk.offset))
                    .await
                    .map_err(|error| {
                        ApiCommandError::internal(format!(
                            "Could not seek partial download: {error}"
                        ))
                    })?;
                output.write_all(&bytes).await.map_err(|error| {
                    ApiCommandError::internal(format!("Could not write partial download: {error}"))
                })?;
                completed.insert(chunk.index);
                downloaded = downloaded.saturating_add(chunk.size).min(manifest.size);
                progress(DirectDownloadProgress {
                    phase: super::DownloadTaskPhase::Transferring,
                    downloaded_bytes: downloaded.min(manifest.size),
                    total_bytes: Some(manifest.size),
                    completed_chunks: completed.len(),
                    total_chunks: Some(manifest.chunk_count),
                })?;
            }
            save_resume(&sidecar, &manifest, &completed).await?;
        }
        next = window.next_start.unwrap_or_else(|| {
            window
                .chunks
                .last()
                .map(|chunk| chunk.index + 1)
                .unwrap_or(manifest.chunk_count)
        });
    }
    output.flush().await.map_err(|error| {
        ApiCommandError::internal(format!("Could not flush partial download: {error}"))
    })?;
    drop(output);
    ensure_not_cancelled(cancel.as_ref())?;
    progress(DirectDownloadProgress {
        phase: super::DownloadTaskPhase::Verifying,
        downloaded_bytes: manifest.size,
        total_bytes: Some(manifest.size),
        completed_chunks: completed.len(),
        total_chunks: Some(manifest.chunk_count),
    })?;
    if let Err(error) = verify_file(&temporary, manifest.size, &manifest.sha256).await {
        let _ = fs::remove_file(&sidecar).await;
        diagnostics::error(
            "download.direct",
            format!("verify_failed file_id={file_id} error={}", error.message()),
        );
        return Err(error.into());
    }
    progress(DirectDownloadProgress {
        phase: super::DownloadTaskPhase::Finalizing,
        downloaded_bytes: manifest.size,
        total_bytes: Some(manifest.size),
        completed_chunks: completed.len(),
        total_chunks: Some(manifest.chunk_count),
    })?;
    replace_destination(&temporary, destination).await?;
    let _ = fs::remove_file(&sidecar).await;
    diagnostics::info(
        "download.direct",
        format!("complete file_id={file_id} size={}", manifest.size),
    );
    Ok(manifest.size)
}

pub(crate) async fn download_folder_direct(
    api: &ApiState,
    folder_id: String,
    destination: String,
) -> Result<(), ApiCommandError> {
    let root = PathBuf::from(destination);
    if root.as_os_str().is_empty() {
        return Err(ApiCommandError::invalid_request(
            "Download destination is required.",
        ));
    }
    fs::create_dir_all(&root).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not create download directory: {error}"))
    })?;
    let metadata = fs::metadata(&root).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not inspect download directory: {error}"))
    })?;
    if !metadata.is_dir() {
        return Err(ApiCommandError::invalid_request(
            "Folder download destination must be a directory.",
        ));
    }
    let response = api
        .raw_request(
            Method::GET,
            &format!("/api/v1/folders/{folder_id}/desktop-download/manifest"),
            Vec::new(),
            Vec::new(),
        )
        .await?;
    if !response.status().is_success() {
        return Err(response_error(response).await);
    }
    let manifest = response
        .json::<DirectFolderManifest>()
        .await
        .map_err(|error| {
            ApiCommandError::internal(format!(
                "Could not decode folder download manifest: {error}"
            ))
        })?;
    for entry in manifest.entries {
        let target = safe_manifest_path(&root, &entry.path)?;
        match entry.kind.as_str() {
            "folder" => fs::create_dir_all(&target).await.map_err(|error| {
                ApiCommandError::internal(format!(
                    "Could not create folder download directory: {error}"
                ))
            })?,
            "file" => {
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).await.map_err(|error| {
                        ApiCommandError::internal(format!(
                            "Could not create folder download directory: {error}"
                        ))
                    })?;
                }
                let file_id = entry.file_id.ok_or_else(|| {
                    ApiCommandError::internal("Folder manifest file is missing an ID.")
                })?;
                download_file_direct(api, &file_id, None, &target, None, |_| Ok(()))
                    .await
                    .map_err(|error| match error {
                        DirectDownloadError::Cancelled => {
                            ApiCommandError::internal("Folder download was cancelled.")
                        }
                        DirectDownloadError::Failed(error) => error,
                    })?;
            }
            _ => {
                return Err(ApiCommandError::internal(
                    "Folder manifest contains an invalid entry kind.",
                ))
            }
        }
    }
    Ok(())
}

async fn file_manifest(
    api: &ApiState,
    file_id: &str,
    collection_id: Option<&str>,
) -> Result<DirectFileManifest, ApiCommandError> {
    let response = api
        .raw_request(
            Method::GET,
            &format!("/api/v1/files/{file_id}/desktop-download/manifest"),
            control_query(collection_id),
            Vec::new(),
        )
        .await?;
    if !response.status().is_success() {
        return Err(response_error(response).await);
    }
    response.json().await.map_err(|error| {
        ApiCommandError::internal(format!(
            "Could not decode direct download manifest: {error}"
        ))
    })
}

async fn chunk_window(
    api: &ApiState,
    file_id: &str,
    collection_id: Option<&str>,
    start: usize,
    limit: usize,
    refresh: bool,
) -> Result<DirectChunkWindow, ApiCommandError> {
    let mut query = control_query(collection_id);
    query.push(("start".to_string(), start.to_string()));
    query.push(("limit".to_string(), limit.to_string()));
    if refresh {
        query.push(("refresh".to_string(), "1".to_string()));
    }
    let response = api
        .raw_request(
            Method::GET,
            &format!("/api/v1/files/{file_id}/desktop-download/chunks"),
            query,
            Vec::new(),
        )
        .await?;
    if !response.status().is_success() {
        return Err(response_error(response).await);
    }
    response.json().await.map_err(|error| {
        ApiCommandError::internal(format!("Could not decode direct download chunks: {error}"))
    })
}

async fn download_chunk(
    api: &ApiState,
    file_id: String,
    collection_id: Option<String>,
    mut chunk: DirectChunk,
    cancel: Option<(Arc<AtomicBool>, Arc<Notify>)>,
) -> Result<(DirectChunk, Vec<u8>), DirectDownloadError> {
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|error| {
            ApiCommandError::internal(format!("Could not create direct download client: {error}"))
        })?;
    for attempt in 0..DIRECT_CHUNK_RETRIES {
        ensure_not_cancelled(cancel.as_ref())?;
        validate_cdn_url(&chunk.url)?;
        let response = if let Some((_, notify)) = cancel.as_ref() {
            tokio::select! { _ = notify.notified() => return Err(DirectDownloadError::Cancelled), response = client.get(&chunk.url).send() => response }
        } else {
            client.get(&chunk.url).send().await
        };
        let response = match response {
            Ok(response) => response,
            Err(_) if attempt + 1 < DIRECT_CHUNK_RETRIES => {
                sleep(Duration::from_millis(300 * (1u64 << attempt))).await;
                continue;
            }
            Err(error) => {
                return Err(ApiCommandError::network(
                    "Direct CDN download failed",
                    error.without_url(),
                )
                .into())
            }
        };
        if matches!(
            response.status(),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
        ) {
            diagnostics::warn(
                "download.direct",
                format!(
                    "refresh_url file_id={file_id} chunk={} status={}",
                    chunk.index,
                    response.status()
                ),
            );
            let refresh = chunk_window(
                api,
                &file_id,
                collection_id.as_deref(),
                chunk.index,
                1,
                true,
            )
            .await?;
            chunk = refresh.chunks.into_iter().next().ok_or_else(|| {
                ApiCommandError::internal("Could not refresh direct download URL.")
            })?;
            continue;
        }
        if response.status().is_success() {
            match response.bytes().await {
                Ok(body) => {
                    let bytes = body.to_vec();
                    if bytes.len() as u64 == chunk.size && sha256_hex(&bytes) == chunk.sha256 {
                        return Ok((chunk, bytes));
                    }
                    if attempt + 1 == DIRECT_CHUNK_RETRIES {
                        return Err(ApiCommandError::internal(format!(
                            "Direct download chunk {} failed integrity verification.",
                            chunk.index
                        ))
                        .into());
                    }
                }
                Err(error) if attempt + 1 == DIRECT_CHUNK_RETRIES => {
                    return Err(ApiCommandError::network(
                        "Could not read direct CDN chunk",
                        error.without_url(),
                    )
                    .into())
                }
                Err(_) => {}
            }
            sleep(Duration::from_millis(300 * (1u64 << attempt))).await;
            continue;
        }
        if attempt + 1 == DIRECT_CHUNK_RETRIES
            || !(response.status() == StatusCode::TOO_MANY_REQUESTS
                || response.status().is_server_error())
        {
            return Err(ApiCommandError::internal(format!(
                "Discord CDN returned HTTP {}.",
                response.status()
            ))
            .into());
        }
        sleep(Duration::from_millis(300 * (1u64 << attempt))).await;
    }
    Err(ApiCommandError::internal("Direct download retry loop exited unexpectedly.").into())
}

fn validate_file_manifest(
    manifest: &DirectFileManifest,
    file_id: &str,
) -> Result<(), DirectDownloadError> {
    let invalid = |reason: String| {
        diagnostics::error(
            "download.direct.manifest",
            format!("file_id={file_id} {reason}"),
        );
        DirectDownloadError::from(ApiCommandError::internal(reason))
    };
    if manifest.id != file_id {
        return Err(invalid(
            "Direct download manifest file ID does not match the requested file.".to_string(),
        ));
    }
    if manifest.chunk_size == 0 {
        return Err(invalid(
            "Direct download manifest has an invalid chunk size.".to_string(),
        ));
    }
    if manifest.chunk_window_size == 0 {
        return Err(invalid(
            "Direct download manifest has an invalid chunk window size.".to_string(),
        ));
    }
    let expected_chunks = if manifest.size == 0 {
        0
    } else {
        manifest.size.div_ceil(manifest.chunk_size)
    };
    if manifest.chunk_count as u64 != expected_chunks {
        return Err(invalid(format!(
            "Direct download manifest chunk count is invalid: expected {expected_chunks}, got {}.",
            manifest.chunk_count
        )));
    }
    if !manifest.sha256.is_empty()
        && (manifest.sha256.len() != 64
            || !manifest.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        return Err(invalid(
            "Direct download manifest contains an invalid SHA-256 digest.".to_string(),
        ));
    }
    Ok(())
}

fn control_query(collection_id: Option<&str>) -> Vec<(String, String)> {
    collection_id
        .map(|id| vec![("collectionId".to_string(), id.to_string())])
        .unwrap_or_default()
}
fn ensure_not_cancelled(
    cancel: Option<&(Arc<AtomicBool>, Arc<Notify>)>,
) -> Result<(), DirectDownloadError> {
    if cancel.is_some_and(|(flag, _)| flag.load(Ordering::Relaxed)) {
        Err(DirectDownloadError::Cancelled)
    } else {
        Ok(())
    }
}
fn validate_cdn_url(value: &str) -> Result<(), ApiCommandError> {
    let url = Url::parse(value)
        .map_err(|_| ApiCommandError::internal("Backend returned an invalid CDN URL."))?;
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https" || !matches!(host, "cdn.discordapp.com" | "media.discordapp.net") {
        return Err(ApiCommandError::internal(
            "Backend returned an unexpected CDN URL.",
        ));
    }
    Ok(())
}
fn bytes_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    bytes_hex(hasher.finalize().as_ref())
}

async fn verify_file(
    path: &Path,
    expected_size: u64,
    expected_sha: &str,
) -> Result<(), ApiCommandError> {
    let metadata = fs::metadata(path).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not inspect downloaded file: {error}"))
    })?;
    if metadata.len() != expected_size {
        return Err(ApiCommandError::internal(
            "Downloaded file size verification failed.",
        ));
    }
    if expected_sha.is_empty() {
        return Ok(());
    }
    let mut file = File::open(path).await.map_err(|error| {
        ApiCommandError::internal(format!(
            "Could not open downloaded file for verification: {error}"
        ))
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer).await.map_err(|error| {
            ApiCommandError::internal(format!("Could not verify downloaded file: {error}"))
        })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    if bytes_hex(hasher.finalize().as_ref()) != expected_sha {
        return Err(ApiCommandError::internal(
            "Downloaded file SHA-256 verification failed.",
        ));
    }
    Ok(())
}

fn resume_paths(destination: &Path) -> Result<(PathBuf, PathBuf), ApiCommandError> {
    let name = destination.file_name().ok_or_else(|| {
        ApiCommandError::invalid_request("Download destination must be a file path.")
    })?;
    let mut partial = OsString::from(".");
    partial.push(name);
    partial.push(".discloud.part");
    let temporary = destination.with_file_name(partial);
    let mut sidecar = temporary.as_os_str().to_os_string();
    sidecar.push(".json");
    Ok((temporary, PathBuf::from(sidecar)))
}

async fn load_resume(
    sidecar: &Path,
    temporary: &Path,
    manifest: &DirectFileManifest,
) -> HashSet<usize> {
    let Ok(metadata) = fs::metadata(temporary).await else {
        return HashSet::new();
    };
    if metadata.len() != manifest.size {
        return HashSet::new();
    }
    let Ok(bytes) = fs::read(sidecar).await else {
        return HashSet::new();
    };
    let Ok(state) = serde_json::from_slice::<ResumeState>(&bytes) else {
        return HashSet::new();
    };
    if state.file_id != manifest.id
        || state.size != manifest.size
        || state.sha256 != manifest.sha256
    {
        return HashSet::new();
    }
    state.completed.into_iter().collect()
}

async fn save_resume(
    sidecar: &Path,
    manifest: &DirectFileManifest,
    completed: &HashSet<usize>,
) -> Result<(), ApiCommandError> {
    let mut completed = completed.iter().copied().collect::<Vec<_>>();
    completed.sort_unstable();
    let bytes = serde_json::to_vec(&ResumeState {
        file_id: manifest.id.clone(),
        size: manifest.size,
        sha256: manifest.sha256.clone(),
        completed,
    })
    .map_err(|error| {
        ApiCommandError::internal(format!("Could not encode download resume state: {error}"))
    })?;
    fs::write(sidecar, bytes).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not save download resume state: {error}"))
    })
}

fn resume_completed_bytes(completed: &HashSet<usize>, manifest: &DirectFileManifest) -> u64 {
    completed
        .iter()
        .map(|index| {
            let offset = *index as u64 * manifest.chunk_size;
            manifest
                .size
                .saturating_sub(offset)
                .min(manifest.chunk_size)
        })
        .sum::<u64>()
        .min(manifest.size)
}

fn safe_manifest_path(root: &Path, value: &str) -> Result<PathBuf, ApiCommandError> {
    let relative = Path::new(value);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(ApiCommandError::internal(
            "Folder manifest contains an unsafe path.",
        ));
    }
    Ok(root.join(relative))
}

async fn replace_destination(temporary: &Path, destination: &Path) -> Result<(), ApiCommandError> {
    if fs::metadata(destination).await.is_err() {
        return fs::rename(temporary, destination).await.map_err(|error| {
            ApiCommandError::internal(format!("Could not finalize download: {error}"))
        });
    }
    let backup = destination.with_extension(format!("discloud-backup-{}", std::process::id()));
    fs::rename(destination, &backup).await.map_err(|error| {
        ApiCommandError::internal(format!(
            "Could not stage existing download destination: {error}"
        ))
    })?;
    match fs::rename(temporary, destination).await {
        Ok(()) => {
            let _ = fs::remove_file(backup).await;
            Ok(())
        }
        Err(error) => {
            let _ = fs::rename(&backup, destination).await;
            Err(ApiCommandError::internal(format!(
                "Could not finalize download: {error}"
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_file_manifest, DirectFileManifest};

    fn manifest(sha256: &str) -> DirectFileManifest {
        DirectFileManifest {
            id: "file-1".to_string(),
            size: 10,
            chunk_size: 4,
            chunk_count: 3,
            chunk_window_size: 16,
            sha256: sha256.to_string(),
        }
    }

    #[test]
    fn direct_manifest_allows_missing_whole_file_sha256() {
        assert!(validate_file_manifest(&manifest(""), "file-1").is_ok());
    }

    #[test]
    fn direct_manifest_rejects_malformed_whole_file_sha256() {
        assert!(validate_file_manifest(&manifest("not-a-sha"), "file-1").is_err());
    }
}
