use std::{
    collections::HashMap,
    ffi::OsString,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, RwLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::Method;
use tauri::{
    http::{Request, Response, StatusCode},
    AppHandle, Manager, UriSchemeResponder,
};
use tauri_plugin_shell::ShellExt;
use tokio::{fs, sync::Semaphore, time::sleep};

use crate::api::{response_error, ApiCommandError, ApiState};

mod native;

const THUMBNAIL_SIZE_MAX: u32 = 1024;
const CLIENT_THUMBNAIL_MAX_BYTES: usize = 8 * 1024 * 1024;
const PUBLISH_RETRY_DELAYS: &[Duration] = &[
    Duration::from_millis(150),
    Duration::from_millis(300),
    Duration::from_millis(600),
    Duration::from_millis(1000),
    Duration::from_millis(1500),
    Duration::from_millis(2000),
    Duration::from_millis(2000),
    Duration::from_millis(2000),
];

#[derive(Clone)]
pub(crate) struct ThumbnailState {
    files: Arc<RwLock<HashMap<String, PathBuf>>>,
    gate: Arc<Semaphore>,
    sequence: Arc<AtomicU64>,
}

impl Default for ThumbnailState {
    fn default() -> Self {
        Self {
            files: Arc::new(RwLock::new(HashMap::new())),
            gate: Arc::new(Semaphore::new(2)),
            sequence: Arc::new(AtomicU64::new(0)),
        }
    }
}

pub(crate) struct GeneratedThumbnail {
    pub(crate) key: String,
}

enum ThumbnailKind {
    StaticImage,
    AnimatedMedia,
    Video,
    Audio,
    Unsupported,
}

pub(crate) fn setup(app: &AppHandle) {
    let Ok(directory) = cache_directory(app) else {
        return;
    };
    let _ = std::fs::remove_dir_all(&directory);
    let _ = std::fs::create_dir_all(directory);
}

pub(crate) fn clear_cache(app: &AppHandle) {
    let state = app.state::<ThumbnailState>();
    if let Ok(mut files) = state.files.write() {
        files.clear();
    }
    if let Ok(directory) = cache_directory(app) {
        let _ = std::fs::remove_dir_all(&directory);
        let _ = std::fs::create_dir_all(directory);
    }
}

pub(crate) async fn get_thumbnail(
    app: &AppHandle,
    path: &Path,
    size: u32,
) -> Result<GeneratedThumbnail, ApiCommandError> {
    if size == 0 || size > THUMBNAIL_SIZE_MAX {
        return Err(ApiCommandError::invalid_request("Invalid thumbnail size."));
    }
    if !path.is_file() {
        return Err(ApiCommandError::invalid_request(
            "Thumbnail source must be a local file.",
        ));
    }

    let state = app.state::<ThumbnailState>();
    let permit = state
        .gate
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| ApiCommandError::internal("Thumbnail generator is unavailable."))?;
    let key = next_key(&state);
    let directory = cache_directory(app)?;
    fs::create_dir_all(&directory).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not create thumbnail cache: {error}"))
    })?;
    let output = directory.join(format!("{key}.png"));
    let temporary = directory.join(format!(".{key}.part.png"));
    let _ = fs::remove_file(&temporary).await;

    let native_input = path.to_path_buf();
    let native_output = temporary.clone();
    let native_result = tauri::async_runtime::spawn_blocking(move || {
        native::generate(&native_input, &native_output, size)
    })
    .await;

    let generated = matches!(native_result, Ok(Ok(()))) && valid_thumbnail_file(&temporary);
    if !generated {
        let _ = fs::remove_file(&temporary).await;
        let kind = detect_kind(path)?;
        match kind {
            ThumbnailKind::StaticImage => {
                if generate_image_thumbnail(path, &temporary, size)
                    .await
                    .is_err()
                {
                    let _ = fs::remove_file(&temporary).await;
                    generate_ffmpeg_thumbnail(
                        app,
                        path,
                        &temporary,
                        size,
                        ThumbnailKind::StaticImage,
                    )
                    .await?;
                }
            }
            kind @ (ThumbnailKind::AnimatedMedia | ThumbnailKind::Video | ThumbnailKind::Audio) => {
                generate_ffmpeg_thumbnail(app, path, &temporary, size, kind).await?
            }
            ThumbnailKind::Unsupported => {
                drop(permit);
                return Err(ApiCommandError::invalid_request(
                    "No thumbnail provider supports this file.",
                ));
            }
        }
    }

    if !valid_thumbnail_file(&temporary) {
        let _ = fs::remove_file(&temporary).await;
        drop(permit);
        return Err(ApiCommandError::internal(
            "Thumbnail provider returned an invalid image.",
        ));
    }

    fs::rename(&temporary, &output).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not finalize local thumbnail: {error}"))
    })?;
    state
        .files
        .write()
        .map_err(|_| ApiCommandError::internal("Thumbnail cache lock is poisoned."))?
        .insert(key.clone(), output);
    drop(permit);
    Ok(GeneratedThumbnail { key })
}

pub(crate) async fn publish_cached_thumbnail(
    app: &AppHandle,
    api: &ApiState,
    file_id: &str,
    key: &str,
) -> Result<(), ApiCommandError> {
    if !valid_resource_id(file_id) {
        return Err(ApiCommandError::invalid_request("Invalid file ID."));
    }
    let path = cached_path(app, key)?
        .ok_or_else(|| ApiCommandError::invalid_request("Local thumbnail is unavailable."))?;
    let body = fs::read(path).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not read local thumbnail: {error}"))
    })?;
    if body.is_empty() || body.len() > CLIENT_THUMBNAIL_MAX_BYTES {
        return Err(ApiCommandError::invalid_request(
            "Local thumbnail has an invalid size.",
        ));
    }

    let endpoint = format!("/api/v1/files/{file_id}/thumbnail");
    for attempt in 0..=PUBLISH_RETRY_DELAYS.len() {
        let response = api
            .raw_request_body(
                Method::PUT,
                &endpoint,
                Vec::new(),
                vec![("Content-Type".to_string(), "image/png".to_string())],
                body.clone(),
            )
            .await?;

        if response.status().is_success() {
            let _ = response.bytes().await;
            return Ok(());
        }

        let error = response_error(response).await;
        if error.message() == "thumbnail is only supported for image, video, and audio files" {
            return Ok(());
        }
        if error.message() != "file metadata is not ready"
            && error.message() != "thumbnail is not pending"
        {
            return Err(error);
        }

        let Some(delay) = PUBLISH_RETRY_DELAYS.get(attempt) else {
            return Ok(());
        };
        sleep(*delay).await;
    }
    Ok(())
}

pub(crate) fn respond_protocol(
    app: AppHandle,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    tauri::async_runtime::spawn(async move {
        responder.respond(handle_protocol(app, request).await);
    });
}

async fn handle_protocol(app: AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method().as_str() == "OPTIONS" {
        return protocol_response(StatusCode::NO_CONTENT, Vec::new(), None, "no-store");
    }
    if request.method().as_str() != "GET" && request.method().as_str() != "HEAD" {
        return protocol_response(
            StatusCode::METHOD_NOT_ALLOWED,
            b"Method not allowed.".to_vec(),
            Some("text/plain; charset=utf-8"),
            "no-store",
        );
    }

    let normalized = request.uri().path().replace("%2F", "/").replace("%2f", "/");
    let segments = normalized.trim_matches('/').split('/').collect::<Vec<_>>();
    match segments.as_slice() {
        ["local", key] if valid_key(key) => {
            local_response(&app, key, request.method().as_str()).await
        }
        ["files", file_id] if valid_resource_id(file_id) => {
            remote_response(&app, file_id, request.method().as_str()).await
        }
        _ => protocol_response(
            StatusCode::NOT_FOUND,
            b"Thumbnail route not found.".to_vec(),
            Some("text/plain; charset=utf-8"),
            "no-store",
        ),
    }
}

async fn local_response(app: &AppHandle, key: &str, method: &str) -> Response<Vec<u8>> {
    let path = match cached_path(app, key) {
        Ok(Some(path)) => path,
        _ => {
            return protocol_response(
                StatusCode::NOT_FOUND,
                b"Local thumbnail not found.".to_vec(),
                Some("text/plain; charset=utf-8"),
                "no-store",
            )
        }
    };
    let body = if method == "HEAD" {
        Vec::new()
    } else {
        match fs::read(path).await {
            Ok(body) => body,
            Err(_) => {
                return protocol_response(
                    StatusCode::NOT_FOUND,
                    b"Local thumbnail not found.".to_vec(),
                    Some("text/plain; charset=utf-8"),
                    "no-store",
                )
            }
        }
    };
    protocol_response(StatusCode::OK, body, Some("image/png"), "no-store")
}

async fn remote_response(app: &AppHandle, file_id: &str, method: &str) -> Response<Vec<u8>> {
    let state = app.state::<ApiState>();
    let endpoint = format!("/api/v1/files/{file_id}/thumbnail");
    let method = if method == "HEAD" {
        Method::HEAD
    } else {
        Method::GET
    };
    match state
        .raw_request(method, &endpoint, Vec::new(), Vec::new())
        .await
    {
        Ok(response) => proxy_response(response).await,
        Err(error) => protocol_response(
            StatusCode::BAD_GATEWAY,
            error.message().as_bytes().to_vec(),
            Some("text/plain; charset=utf-8"),
            "no-store",
        ),
    }
}

async fn proxy_response(response: reqwest::Response) -> Response<Vec<u8>> {
    let status =
        StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let cache_control = response
        .headers()
        .get(reqwest::header::CACHE_CONTROL)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("private, max-age=300")
        .to_string();
    let body = match response.bytes().await {
        Ok(body) => body.to_vec(),
        Err(error) => {
            return protocol_response(
                StatusCode::BAD_GATEWAY,
                format!("Could not read thumbnail response: {error}").into_bytes(),
                Some("text/plain; charset=utf-8"),
                "no-store",
            )
        }
    };
    protocol_response(status, body, content_type.as_deref(), &cache_control)
}

fn protocol_response(
    status: StatusCode,
    body: Vec<u8>,
    content_type: Option<&str>,
    cache_control: &str,
) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header("access-control-allow-origin", "*")
        .header("access-control-allow-methods", "GET, HEAD, OPTIONS")
        .header("cross-origin-resource-policy", "cross-origin")
        .header("cache-control", cache_control);
    if let Some(content_type) = content_type {
        builder = builder.header("content-type", content_type);
    }
    builder
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

async fn generate_image_thumbnail(
    input: &Path,
    output: &Path,
    size: u32,
) -> Result<(), ApiCommandError> {
    let input = input.to_path_buf();
    let output = output.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let image = image::open(&input).map_err(|error| {
            ApiCommandError::invalid_request(format!("Could not decode image thumbnail: {error}"))
        })?;
        image
            .thumbnail(size, size)
            .save_with_format(&output, image::ImageFormat::Png)
            .map_err(|error| {
                ApiCommandError::internal(format!("Could not encode image thumbnail: {error}"))
            })
    })
    .await
    .map_err(|error| ApiCommandError::internal(format!("Thumbnail worker failed: {error}")))?
}

async fn generate_ffmpeg_thumbnail(
    app: &AppHandle,
    input: &Path,
    output: &Path,
    size: u32,
    kind: ThumbnailKind,
) -> Result<(), ApiCommandError> {
    let scale = format!("scale={size}:{size}:force_original_aspect_ratio=decrease");
    let filter = if matches!(kind, ThumbnailKind::Audio | ThumbnailKind::StaticImage) {
        scale
    } else {
        format!("thumbnail=30,{scale}")
    };
    let args = vec![
        OsString::from("-nostdin"),
        OsString::from("-hide_banner"),
        OsString::from("-loglevel"),
        OsString::from("error"),
        OsString::from("-i"),
        input.as_os_str().to_os_string(),
        OsString::from("-map"),
        OsString::from("0:v:0"),
        OsString::from("-an"),
        OsString::from("-sn"),
        OsString::from("-dn"),
        OsString::from("-vf"),
        OsString::from(filter),
        OsString::from("-frames:v"),
        OsString::from("1"),
        OsString::from("-y"),
        output.as_os_str().to_os_string(),
    ];

    let sidecar = app.shell().sidecar("ffmpeg");
    let output_result = match sidecar {
        Ok(command) => command.args(args.clone()).output().await,
        Err(error) => Err(error),
    };
    let command_output = match output_result {
        Ok(output) => output,
        Err(_) => app
            .shell()
            .command("ffmpeg")
            .args(args)
            .output()
            .await
            .map_err(|error| {
                ApiCommandError::internal(format!(
                    "FFmpeg thumbnail provider is unavailable: {error}"
                ))
            })?,
    };
    if !command_output.status.success() {
        let detail = String::from_utf8_lossy(&command_output.stderr)
            .trim()
            .to_string();
        return Err(ApiCommandError::invalid_request(if detail.is_empty() {
            "FFmpeg could not generate a thumbnail.".to_string()
        } else {
            format!(
                "FFmpeg could not generate a thumbnail: {}",
                truncate(&detail, 500)
            )
        }));
    }
    Ok(())
}

fn detect_kind(path: &Path) -> Result<ThumbnailKind, ApiCommandError> {
    let mut file = File::open(path).map_err(|error| {
        ApiCommandError::invalid_request(format!("Could not inspect thumbnail source: {error}"))
    })?;
    let mut prefix = vec![0u8; 8192];
    let read = file.read(&mut prefix).map_err(|error| {
        ApiCommandError::invalid_request(format!("Could not inspect thumbnail source: {error}"))
    })?;
    prefix.truncate(read);
    let mime = infer::get(&prefix)
        .map(|kind| kind.mime_type())
        .unwrap_or("");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if mime == "image/gif" || extension == "gif" || is_animated_webp(&prefix) {
        return Ok(ThumbnailKind::AnimatedMedia);
    }
    if matches!(mime, "image/png" | "image/jpeg" | "image/webp")
        || matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp")
    {
        return Ok(ThumbnailKind::StaticImage);
    }
    if mime.starts_with("video/")
        || matches!(
            extension.as_str(),
            "mp4" | "m4v" | "mov" | "mkv" | "webm" | "avi"
        )
    {
        return Ok(ThumbnailKind::Video);
    }
    if mime.starts_with("audio/")
        || matches!(
            extension.as_str(),
            "mp3" | "m4a" | "aac" | "flac" | "ogg" | "opus" | "wav"
        )
    {
        return Ok(ThumbnailKind::Audio);
    }
    if mime.starts_with("image/") {
        return Ok(ThumbnailKind::AnimatedMedia);
    }
    Ok(ThumbnailKind::Unsupported)
}

fn is_animated_webp(prefix: &[u8]) -> bool {
    prefix.len() > 20
        && prefix.starts_with(b"RIFF")
        && prefix.get(8..12).is_some_and(|value| value == b"WEBP")
        && prefix.get(12..16).is_some_and(|value| value == b"VP8X")
        && prefix[20] & 0x02 != 0
}

fn valid_thumbnail_file(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|metadata| {
        metadata.is_file()
            && metadata.len() > 0
            && metadata.len() <= CLIENT_THUMBNAIL_MAX_BYTES as u64
    }) && image::open(path).is_ok_and(|image| image.width() > 0 && image.height() > 0)
}

fn cached_path(app: &AppHandle, key: &str) -> Result<Option<PathBuf>, ApiCommandError> {
    if !valid_key(key) {
        return Ok(None);
    }
    let state = app.state::<ThumbnailState>();
    state
        .files
        .read()
        .map_err(|_| ApiCommandError::internal("Thumbnail cache lock is poisoned."))
        .map(|files| files.get(key).cloned())
}

fn cache_directory(app: &AppHandle) -> Result<PathBuf, ApiCommandError> {
    app.path()
        .app_cache_dir()
        .map(|path| path.join("upload-thumbnails"))
        .map_err(|error| {
            ApiCommandError::internal(format!(
                "Could not resolve thumbnail cache directory: {error}"
            ))
        })
}

fn next_key(state: &ThumbnailState) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = state.sequence.fetch_add(1, Ordering::Relaxed);
    format!("{:x}{:x}{:x}", std::process::id(), timestamp, sequence)
}

fn valid_key(value: &str) -> bool {
    !value.is_empty() && value.len() <= 96 && value.bytes().all(|value| value.is_ascii_hexdigit())
}

fn valid_resource_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'-' || value == b'_')
}

fn truncate(value: &str, limit: usize) -> String {
    let mut chars = value.chars();
    let mut output = chars.by_ref().take(limit).collect::<String>();
    if chars.next().is_some() {
        output.push_str("...");
    }
    output
}
