use std::path::Path;

use reqwest::{header::CONTENT_TYPE, Method, StatusCode};
use serde::{Deserialize, Serialize};
use tokio::fs;

use crate::api::{response_error, ApiCommandError, ApiState};

const MAX_AVATAR_BYTES: u64 = 10 * 1024 * 1024;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AvatarInfo {
    has_avatar: bool,
    avatar_revision: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AvatarPayload {
    content_type: String,
    bytes: Vec<u8>,
}

pub(crate) async fn update_avatar(
    api: &ApiState,
    path: String,
) -> Result<AvatarInfo, ApiCommandError> {
    let metadata = fs::symlink_metadata(&path).await.map_err(|error| {
        ApiCommandError::invalid_request(format!("Could not read avatar file: {error}"))
    })?;

    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(ApiCommandError::invalid_request(
            "Avatar path must point to a regular file.",
        ));
    }

    if metadata.len() > MAX_AVATAR_BYTES {
        return Err(ApiCommandError::invalid_request(
            "Avatar must be 10 MiB or smaller.",
        ));
    }

    let body = fs::read(&path).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not read avatar file: {error}"))
    })?;

    if body.is_empty() {
        return Err(ApiCommandError::invalid_request("Avatar file is empty."));
    }

    if body.len() as u64 > MAX_AVATAR_BYTES {
        return Err(ApiCommandError::invalid_request(
            "Avatar must be 10 MiB or smaller.",
        ));
    }

    let response = api
        .raw_request_body(
            Method::PUT,
            "/api/v1/me/avatar",
            Vec::new(),
            vec![(
                "Content-Type".to_string(),
                avatar_content_type(&path).to_string(),
            )],
            body,
        )
        .await?;

    if !response.status().is_success() {
        return Err(response_error(response).await);
    }

    response.json::<AvatarInfo>().await.map_err(|error| {
        ApiCommandError::internal(format!("Could not decode avatar response: {error}"))
    })
}

pub(crate) async fn load_avatar(api: &ApiState) -> Result<Option<AvatarPayload>, ApiCommandError> {
    let response = api
        .raw_request(Method::GET, "/api/v1/me/avatar", Vec::new(), Vec::new())
        .await?;

    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }

    if !response.status().is_success() {
        return Err(response_error(response).await);
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| ApiCommandError::network("Could not load avatar", error))?
        .to_vec();

    Ok(Some(AvatarPayload {
        content_type,
        bytes,
    }))
}

pub(crate) async fn save_recovery_codes(
    destination: String,
    codes: Vec<String>,
) -> Result<(), ApiCommandError> {
    if destination.trim().is_empty() {
        return Err(ApiCommandError::invalid_request(
            "Recovery code destination is required.",
        ));
    }

    if codes.is_empty() || codes.iter().any(|code| code.trim().is_empty()) {
        return Err(ApiCommandError::invalid_request(
            "Recovery codes are missing.",
        ));
    }

    let destination = Path::new(&destination);

    if destination.file_name().is_none() {
        return Err(ApiCommandError::invalid_request(
            "Recovery code destination must be a file path.",
        ));
    }

    let content = format!("DisCloud recovery codes\n\n{}\n", codes.join("\n"));

    fs::write(destination, content).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not save recovery codes: {error}"))
    })
}

fn avatar_content_type(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::avatar_content_type;

    #[test]
    fn detects_avatar_content_type() {
        assert_eq!(avatar_content_type("avatar.jpg"), "image/jpeg");
        assert_eq!(avatar_content_type("avatar.PNG"), "image/png");
        assert_eq!(avatar_content_type("avatar.webp"), "image/webp");
        assert_eq!(
            avatar_content_type("avatar.bin"),
            "application/octet-stream"
        );
    }
}
