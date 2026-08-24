use std::{collections::HashSet, path::Path};

use reqwest::Method;
use serde::Deserialize;
use tauri::{State, WebviewWindow};

use crate::api::{response_error, ApiCommandError, ApiState};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncValidationPair {
    id: String,
    local_path: String,
    remote_folder_id: String,
    direction: SyncDirection,
    #[serde(default = "default_sync_enabled")]
    enabled: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum SyncDirection {
    TwoWay,
    DownloadOnly,
    UploadOnly,
}

#[derive(Debug, Deserialize)]
struct BreadcrumbsResponse {
    breadcrumbs: Vec<BreadcrumbNode>,
}

#[derive(Debug, Deserialize)]
struct BreadcrumbNode {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FolderPageAccess {
    access_level: String,
}

struct ValidatedPair {
    local_key: String,
    remote_folder_id: String,
    remote_path: Vec<String>,
}

#[tauri::command]
pub(crate) async fn validate_sync_pairs(
    window: WebviewWindow,
    api_state: State<'_, ApiState>,
    pairs: Vec<SyncValidationPair>,
) -> Result<(), ApiCommandError> {
    validate_sync_pair_topology(&window, api_state.inner(), &pairs).await
}

pub(crate) async fn validate_sync_pair_topology(
    window: &WebviewWindow,
    api: &ApiState,
    pairs: &[SyncValidationPair],
) -> Result<(), ApiCommandError> {
    let mut validated = Vec::with_capacity(pairs.len());
    let mut pair_ids = HashSet::with_capacity(pairs.len());

    for pair in pairs {
        validate_pair_shape(pair)?;
        if !pair_ids.insert(pair.id.clone()) {
            return Err(ApiCommandError::invalid_request("Duplicate sync pair ID."));
        }
        if !pair.enabled {
            continue;
        }
        let local_root = super::grants::authorize_pair(window, &pair.id, &pair.local_path).await?;
        let remote_path = load_remote_path(api, &pair.remote_folder_id).await?;
        let access_level = load_remote_access(api, &pair.remote_folder_id).await?;

        if pair.direction != SyncDirection::DownloadOnly && access_level == "view" {
            return Err(ApiCommandError::invalid_request(
                "This DisCloud folder is read-only. Use download-only sync for this folder.",
            ));
        }

        validated.push(ValidatedPair {
            local_key: normalized_local_key(&local_root),
            remote_folder_id: pair.remote_folder_id.clone(),
            remote_path,
        });
    }

    for left_index in 0..validated.len() {
        for right_index in (left_index + 1)..validated.len() {
            let left = &validated[left_index];
            let right = &validated[right_index];

            if paths_overlap(&left.local_key, &right.local_key) {
                return Err(ApiCommandError::invalid_request(
                    "This local folder overlaps another configured sync root.",
                ));
            }

            if remote_paths_overlap(left, right) {
                return Err(ApiCommandError::invalid_request(
                    "This DisCloud folder overlaps another configured sync root.",
                ));
            }
        }
    }

    Ok(())
}

async fn load_remote_path(api: &ApiState, folder_id: &str) -> Result<Vec<String>, ApiCommandError> {
    let response = api
        .request_json::<BreadcrumbsResponse>(
            Method::GET,
            format!("/api/v1/folders/{folder_id}/breadcrumbs"),
            None,
        )
        .await?;
    let path = response
        .breadcrumbs
        .into_iter()
        .map(|folder| folder.id)
        .collect::<Vec<_>>();

    if path.last().map(|id| id != folder_id).unwrap_or(true) {
        return Err(ApiCommandError::invalid_response(
            "The server returned invalid folder breadcrumbs.",
        ));
    }

    Ok(path)
}

async fn load_remote_access(api: &ApiState, folder_id: &str) -> Result<String, ApiCommandError> {
    let response = api
        .raw_request(
            Method::GET,
            &format!("/api/v1/folders/{folder_id}/children"),
            vec![("limit".to_string(), "1".to_string())],
            Vec::new(),
        )
        .await?;

    if !response.status().is_success() {
        return Err(response_error(response).await);
    }

    let page = response.json::<FolderPageAccess>().await.map_err(|_| {
        ApiCommandError::invalid_response("The server returned invalid folder access data.")
    })?;

    if !matches!(page.access_level.as_str(), "view" | "edit" | "full") {
        return Err(ApiCommandError::invalid_response(
            "The server returned an invalid folder access level.",
        ));
    }

    Ok(page.access_level)
}

fn validate_pair_shape(pair: &SyncValidationPair) -> Result<(), ApiCommandError> {
    if !valid_identifier(&pair.id) {
        return Err(ApiCommandError::invalid_request("Invalid sync pair ID."));
    }
    if !valid_identifier(&pair.remote_folder_id) {
        return Err(ApiCommandError::invalid_request(
            "Invalid remote folder ID.",
        ));
    }
    if pair.local_path.trim().is_empty() {
        return Err(ApiCommandError::invalid_request("Choose a local folder."));
    }
    Ok(())
}

fn default_sync_enabled() -> bool {
    true
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn normalized_local_key(path: &Path) -> String {
    let mut value = path.to_string_lossy().replace('\\', "/");
    while value.len() > 1 && value.ends_with('/') {
        value.pop();
    }

    #[cfg(windows)]
    {
        value = value.to_lowercase();
    }

    value
}

fn paths_overlap(left: &str, right: &str) -> bool {
    path_contains(left, right) || path_contains(right, left)
}

fn path_contains(parent: &str, child: &str) -> bool {
    parent == child
        || parent == "/" && child.starts_with('/')
        || child
            .strip_prefix(parent)
            .map(|suffix| suffix.starts_with('/'))
            .unwrap_or(false)
}

fn remote_paths_overlap(left: &ValidatedPair, right: &ValidatedPair) -> bool {
    left.remote_folder_id == right.remote_folder_id
        || left
            .remote_path
            .iter()
            .any(|id| id == &right.remote_folder_id)
        || right
            .remote_path
            .iter()
            .any(|id| id == &left.remote_folder_id)
}

#[cfg(test)]
mod tests {
    use super::{paths_overlap, remote_paths_overlap, ValidatedPair};

    #[test]
    fn detects_local_root_overlap_only_on_path_boundaries() {
        assert!(paths_overlap("c:/sync", "c:/sync/photos"));
        assert!(paths_overlap("c:/sync/photos", "c:/sync"));
        assert!(paths_overlap("c:/sync", "c:/sync"));
        assert!(!paths_overlap("c:/sync", "c:/sync-old"));
        assert!(paths_overlap("/", "/home/user"));
    }

    #[test]
    fn detects_remote_ancestor_overlap() {
        let parent = ValidatedPair {
            local_key: "/one".to_string(),
            remote_folder_id: "a".to_string(),
            remote_path: vec!["root".to_string(), "a".to_string()],
        };
        let child = ValidatedPair {
            local_key: "/two".to_string(),
            remote_folder_id: "b".to_string(),
            remote_path: vec!["root".to_string(), "a".to_string(), "b".to_string()],
        };

        assert!(remote_paths_overlap(&parent, &child));

        let sibling = ValidatedPair {
            local_key: "/three".to_string(),
            remote_folder_id: "c".to_string(),
            remote_path: vec!["root".to_string(), "c".to_string()],
        };
        assert!(!remote_paths_overlap(&child, &sibling));
    }
}
