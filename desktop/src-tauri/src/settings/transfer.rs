use std::path::{Path, PathBuf};

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
    path: PathBuf,
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

    let metadata = fs::symlink_metadata(&path).await.map_err(|error| {
        ApiCommandError::invalid_request(format!("Could not revalidate avatar file: {error}"))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(ApiCommandError::invalid_request(
            "Avatar path changed before it could be read.",
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

pub(crate) async fn load_avatar(
    api: &ApiState,
    user_id: Option<String>,
) -> Result<Option<AvatarPayload>, ApiCommandError> {
    let path = avatar_request_path(user_id.as_deref())?;
    let response = api
        .raw_request(Method::GET, &path, Vec::new(), Vec::new())
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
        .map_err(|error| ApiCommandError::network("Could not load avatar", error))?;

    if bytes.len() as u64 > MAX_AVATAR_BYTES {
        return Err(ApiCommandError::internal(
            "Avatar response exceeds the maximum allowed size.",
        ));
    }

    Ok(Some(AvatarPayload {
        content_type,
        bytes: bytes.to_vec(),
    }))
}

pub(crate) async fn save_recovery_codes(
    destination: PathBuf,
    codes: Vec<String>,
) -> Result<(), ApiCommandError> {
    if codes.is_empty() || codes.iter().any(|code| code.trim().is_empty()) {
        return Err(ApiCommandError::invalid_request(
            "Recovery codes are missing.",
        ));
    }

    let content = format!("DisCloud recovery codes\n\n{}\n", codes.join("\n"));
    fs::write(&destination, content).await.map_err(|error| {
        ApiCommandError::internal(format!("Could not save recovery codes: {error}"))
    })
}

fn avatar_request_path(user_id: Option<&str>) -> Result<String, ApiCommandError> {
    let Some(user_id) = user_id else {
        return Ok("/api/v1/me/avatar".to_string());
    };

    let user_id = user_id.trim();

    if user_id.is_empty()
        || !user_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
    {
        return Err(ApiCommandError::invalid_request("Invalid avatar user ID."));
    }

    Ok(format!("/api/v1/admin/users/{user_id}/avatar"))
}

fn avatar_content_type(path: &Path) -> &'static str {
    match path
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
    use std::path::Path;

    use super::{avatar_content_type, avatar_request_path};

    #[test]
    fn detects_avatar_content_type() {
        assert_eq!(avatar_content_type(Path::new("avatar.jpg")), "image/jpeg");
        assert_eq!(avatar_content_type(Path::new("avatar.PNG")), "image/png");
        assert_eq!(avatar_content_type(Path::new("avatar.webp")), "image/webp");
        assert_eq!(
            avatar_content_type(Path::new("avatar.bin")),
            "application/octet-stream"
        );
    }

    #[test]
    fn resolves_current_user_avatar_path() {
        assert_eq!(avatar_request_path(None).unwrap(), "/api/v1/me/avatar");
    }

    #[test]
    fn resolves_admin_user_avatar_path() {
        assert_eq!(
            avatar_request_path(Some("0198d961-20e4-7000-8000-000000000001")).unwrap(),
            "/api/v1/admin/users/0198d961-20e4-7000-8000-000000000001/avatar"
        );
    }

    #[test]
    fn rejects_invalid_avatar_user_id() {
        assert!(avatar_request_path(Some("../me")).is_err());
        assert!(avatar_request_path(Some("")).is_err());
    }
}
