use tauri::State;

use crate::{
    api::{ApiCommandError, ApiRequest, ApiResponse, ApiState, ConnectedServer},
    file_transfer::{self, DownloadResult},
    upload_transfer::{self, LocalUploadFile, UploadPartResult, UploadTransferState},
};

#[tauri::command]
pub(crate) async fn connect_server(
    state: State<'_, ApiState>,
    server_url: String,
) -> Result<ConnectedServer, ApiCommandError> {
    state.connect(server_url).await
}

#[tauri::command]
pub(crate) fn disconnect_server(state: State<'_, ApiState>) -> Result<(), ApiCommandError> {
    state.disconnect()
}

#[tauri::command]
pub(crate) async fn api_request(
    state: State<'_, ApiState>,
    request: ApiRequest,
) -> Result<ApiResponse, ApiCommandError> {
    state.request(request).await
}

#[tauri::command]
pub(crate) async fn download_file(
    state: State<'_, ApiState>,
    file_id: String,
    collection_id: Option<String>,
    destination: String,
) -> Result<DownloadResult, ApiCommandError> {
    file_transfer::download_file(state.inner(), file_id, collection_id, destination).await
}

#[tauri::command]
pub(crate) async fn inspect_upload_files(
    paths: Vec<String>,
) -> Result<Vec<LocalUploadFile>, ApiCommandError> {
    upload_transfer::inspect_files(paths).await
}

#[tauri::command]
pub(crate) fn begin_upload_task(
    state: State<'_, UploadTransferState>,
    task_id: String,
) -> Result<(), ApiCommandError> {
    state.begin(task_id)
}

#[tauri::command]
pub(crate) fn cancel_upload_task(
    state: State<'_, UploadTransferState>,
    task_id: String,
) -> Result<bool, ApiCommandError> {
    state.cancel(&task_id)
}

#[tauri::command]
pub(crate) fn finish_upload_task(
    state: State<'_, UploadTransferState>,
    task_id: String,
) -> Result<(), ApiCommandError> {
    state.finish(&task_id)
}

#[tauri::command]
pub(crate) async fn upload_file_part(
    api_state: State<'_, ApiState>,
    upload_state: State<'_, UploadTransferState>,
    task_id: String,
    upload_id: String,
    path: String,
    part_index: u32,
    offset: u64,
    size: u64,
) -> Result<UploadPartResult, ApiCommandError> {
    upload_transfer::upload_part(
        api_state.inner(),
        upload_state.inner(),
        task_id,
        upload_id,
        path,
        part_index,
        offset,
        size,
    )
    .await
}
