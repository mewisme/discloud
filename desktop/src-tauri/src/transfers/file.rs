use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use reqwest::Method;
use serde::Serialize;
use tauri::{
    http::{Request, Response, StatusCode},
    AppHandle, Manager, UriSchemeResponder,
};
use tokio::{
    fs::{self, File},
    io::AsyncWriteExt,
};

use crate::api::{response_error, ApiCommandError, ApiState};

const REQUEST_HEADERS: &[&str] = &[
    "accept",
    "range",
    "if-range",
    "if-none-match",
    "if-modified-since",
];

const RESPONSE_HEADERS: &[&str] = &[
    "content-type",
    "content-length",
    "content-range",
    "content-disposition",
    "accept-ranges",
    "etag",
    "last-modified",
    "cache-control",
    "x-content-type-options",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadResult {
    bytes_written: u64,
}

struct FileRequestContext {
    file_id: String,
    collection_id: Option<String>,
}

pub(crate) fn respond_file_protocol(
    app: AppHandle,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    tauri::async_runtime::spawn(async move {
        responder.respond(handle_file_protocol(app, request).await);
    });
}

pub(crate) async fn download_file(
    state: &ApiState,
    file_id: String,
    collection_id: Option<String>,
    version_id: Option<String>,
    destination: PathBuf,
) -> Result<DownloadResult, ApiCommandError> {
    let path = match version_id.as_deref() {
        Some(version_id) => {
            if collection_id.is_some() {
                return Err(ApiCommandError::invalid_request(
                    "Version downloads do not accept collection context.",
                ));
            }
            version_file_api_path(&file_id, version_id)?
        }
        None => file_api_path(&file_id, "download")?,
    };
    let query = collection_query(collection_id.as_deref())?;
    let mut response = state
        .raw_request(Method::GET, &path, query, Vec::new())
        .await?;

    if !response.status().is_success() {
        return Err(response_error(response).await);
    }

    let expected_length = response.content_length();
    let temporary = temporary_download_path(&destination)?;
    let mut output = File::create_new(&temporary).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not create download file: {error}"))
    })?;
    let mut bytes_written = 0u64;

    let result: Result<(), ApiCommandError> = async {
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| ApiCommandError::network("Download failed", error))?
        {
            output.write_all(&chunk).await.map_err(|error| {
                ApiCommandError::internal(format!("Could not write download file: {error}"))
            })?;

            bytes_written += chunk.len() as u64;
        }

        output.flush().await.map_err(|error| {
            ApiCommandError::internal(format!("Could not flush download file: {error}"))
        })?;

        if expected_length.is_some_and(|expected| expected != bytes_written) {
            return Err(ApiCommandError::internal(
                "Downloaded file size does not match the server response.",
            ));
        }

        Ok(())
    }
    .await;

    drop(output);

    if let Err(error) = result {
        let _ = fs::remove_file(&temporary).await;
        return Err(error);
    }

    if let Err(error) = fs::rename(&temporary, &destination).await {
        let _ = fs::remove_file(&temporary).await;

        return Err(ApiCommandError::internal(format!(
            "Could not finalize download file: {error}"
        )));
    }

    Ok(DownloadResult { bytes_written })
}

async fn handle_file_protocol(app: AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method().as_str() == "OPTIONS" {
        return protocol_response(StatusCode::NO_CONTENT, Vec::new(), None);
    }

    let method = match request.method().as_str() {
        "GET" => Method::GET,
        "HEAD" => Method::HEAD,

        _ => {
            return protocol_response(
                StatusCode::METHOD_NOT_ALLOWED,
                b"Method not allowed.".to_vec(),
                Some("text/plain; charset=utf-8"),
            );
        }
    };

    let Some(context) = protocol_file_context(request.uri().path()) else {
        return protocol_response(
            StatusCode::NOT_FOUND,
            b"File route not found.".to_vec(),
            Some("text/plain; charset=utf-8"),
        );
    };

    let path = match file_api_path(&context.file_id, "content") {
        Ok(path) => path,

        Err(error) => {
            return protocol_response(
                StatusCode::BAD_REQUEST,
                error.message().as_bytes().to_vec(),
                Some("text/plain; charset=utf-8"),
            );
        }
    };

    let query = match collection_query(context.collection_id.as_deref()) {
        Ok(query) => query,

        Err(error) => {
            return protocol_response(
                StatusCode::BAD_REQUEST,
                error.message().as_bytes().to_vec(),
                Some("text/plain; charset=utf-8"),
            );
        }
    };

    let headers = REQUEST_HEADERS
        .iter()
        .filter_map(|name| {
            request
                .headers()
                .get(*name)
                .and_then(|value| value.to_str().ok())
                .map(|value| ((*name).to_string(), value.to_string()))
        })
        .collect();

    let state = app.state::<ApiState>();

    match state.raw_request(method, &path, query, headers).await {
        Ok(response) => proxy_response(response).await,

        Err(error) => protocol_response(
            StatusCode::BAD_GATEWAY,
            error.message().as_bytes().to_vec(),
            Some("text/plain; charset=utf-8"),
        ),
    }
}

async fn proxy_response(response: reqwest::Response) -> Response<Vec<u8>> {
    let status =
        StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);

    let headers = RESPONSE_HEADERS
        .iter()
        .filter_map(|name| {
            response
                .headers()
                .get(*name)
                .and_then(|value| value.to_str().ok())
                .map(|value| ((*name).to_string(), value.to_string()))
        })
        .collect::<Vec<_>>();

    let body = match response.bytes().await {
        Ok(bytes) => bytes.to_vec(),

        Err(error) => {
            return protocol_response(
                StatusCode::BAD_GATEWAY,
                format!("Could not read file response: {error}").into_bytes(),
                Some("text/plain; charset=utf-8"),
            );
        }
    };

    let mut builder = Response::builder()
        .status(status)
        .header("access-control-allow-origin", "*")
        .header("access-control-allow-methods", "GET, HEAD, OPTIONS")
        .header(
            "access-control-allow-headers",
            "Range, If-Range, If-None-Match, If-Modified-Since",
        )
        .header(
            "access-control-expose-headers",
            "Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified",
        )
        .header("cross-origin-resource-policy", "cross-origin");

    for (name, value) in headers {
        builder = builder.header(name, value);
    }

    builder.body(body).unwrap_or_else(|_| {
        protocol_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            b"Could not build file response.".to_vec(),
            Some("text/plain; charset=utf-8"),
        )
    })
}

fn protocol_response(
    status: StatusCode,
    body: Vec<u8>,
    content_type: Option<&str>,
) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header("access-control-allow-origin", "*")
        .header("access-control-allow-methods", "GET, HEAD, OPTIONS")
        .header(
            "access-control-allow-headers",
            "Range, If-Range, If-None-Match, If-Modified-Since",
        )
        .header(
            "access-control-expose-headers",
            "Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified",
        )
        .header("cross-origin-resource-policy", "cross-origin");

    if let Some(content_type) = content_type {
        builder = builder.header("content-type", content_type);
    }

    builder
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn protocol_file_context(path: &str) -> Option<FileRequestContext> {
    let normalized = normalize_protocol_path(path);
    let segments = normalized.trim_matches('/').split('/').collect::<Vec<_>>();

    match segments.as_slice() {
        ["files", file_id] if valid_resource_id(file_id) => Some(FileRequestContext {
            file_id: (*file_id).to_string(),
            collection_id: None,
        }),

        ["collections", collection_id, "files", file_id]
            if valid_resource_id(collection_id) && valid_resource_id(file_id) =>
        {
            Some(FileRequestContext {
                file_id: (*file_id).to_string(),
                collection_id: Some((*collection_id).to_string()),
            })
        }

        _ => None,
    }
}

fn normalize_protocol_path(path: &str) -> String {
    path.replace("%2F", "/").replace("%2f", "/")
}

fn collection_query(collection_id: Option<&str>) -> Result<Vec<(String, String)>, ApiCommandError> {
    match collection_id {
        Some(collection_id) => {
            if !valid_resource_id(collection_id) {
                return Err(ApiCommandError::invalid_request("Invalid collection ID."));
            }

            Ok(vec![(
                "collectionId".to_string(),
                collection_id.to_string(),
            )])
        }

        None => Ok(Vec::new()),
    }
}

fn file_api_path(file_id: &str, action: &str) -> Result<String, ApiCommandError> {
    if !valid_resource_id(file_id) {
        return Err(ApiCommandError::invalid_request("Invalid file ID."));
    }

    Ok(format!("/api/v1/files/{file_id}/{action}"))
}

fn version_file_api_path(file_id: &str, version_id: &str) -> Result<String, ApiCommandError> {
    if !valid_resource_id(file_id) || !valid_resource_id(version_id) {
        return Err(ApiCommandError::invalid_request(
            "Invalid file or version ID.",
        ));
    }
    Ok(format!(
        "/api/v1/files/{file_id}/versions/{version_id}/download"
    ))
}

fn valid_resource_id(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'-' || value == b'_')
}

fn temporary_download_path(destination: &Path) -> Result<PathBuf, ApiCommandError> {
    let original = destination.file_name().ok_or_else(|| {
        ApiCommandError::invalid_request("Download destination must be a file path.")
    })?;

    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    let mut file_name = OsString::from(".");

    file_name.push(original);
    file_name.push(format!(".discloud-{}-{nonce}.part", std::process::id()));

    Ok(destination.with_file_name(file_name))
}

#[cfg(test)]
mod tests {
    use super::{collection_query, protocol_file_context};

    #[test]
    fn parses_workspace_file_protocol_path() {
        let context = protocol_file_context("/files/file-id").unwrap();

        assert_eq!(context.file_id, "file-id");
        assert_eq!(context.collection_id, None);

        let context = protocol_file_context("/files%2Ffile-id").unwrap();
        assert_eq!(context.file_id, "file-id");
        assert_eq!(context.collection_id, None);
    }

    #[test]
    fn parses_collection_file_protocol_path() {
        let context = protocol_file_context("/collections/collection-id/files/file-id").unwrap();

        assert_eq!(context.file_id, "file-id");
        assert_eq!(context.collection_id.as_deref(), Some("collection-id"));

        let context =
            protocol_file_context("/collections%2Fcollection-id%2Ffiles%2Ffile-id").unwrap();
        assert_eq!(context.file_id, "file-id");
        assert_eq!(context.collection_id.as_deref(), Some("collection-id"));
    }

    #[test]
    fn rejects_invalid_protocol_paths() {
        assert!(protocol_file_context("/collections/a/files").is_none());
        assert!(protocol_file_context("/files/a/extra").is_none());
        assert!(protocol_file_context("/collections/a/files/../secret").is_none());
    }

    #[test]
    fn creates_collection_query() {
        assert_eq!(
            collection_query(Some("collection-id")).unwrap(),
            vec![("collectionId".to_string(), "collection-id".to_string(),)],
        );

        assert!(collection_query(None).unwrap().is_empty());
    }
}
