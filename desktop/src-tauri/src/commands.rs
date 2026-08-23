use tauri::{ipc::Channel, State};

use crate::{
    api::{ApiCommandError, ApiRequest, ApiResponse, ApiState, ConnectedServer},
    file_transfer::{self, DownloadResult},
    settings_transfer::{self, AvatarInfo, AvatarPayload},
    upload_transfer::{
        self, LocalUploadFile, UploadRunInput, UploadRunResult, UploadTransferEvent,
        UploadTransferState,
    },
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
pub(crate) async fn cancel_upload_task(
    api_state: State<'_, ApiState>,
    upload_state: State<'_, UploadTransferState>,
    task_id: String,
    upload_id: Option<String>,
) -> Result<bool, ApiCommandError> {
    let cancelled = upload_state.cancel(&task_id)?;

    if let Some(upload_id) = upload_id {
        upload_transfer::cancel_upload(api_state.inner(), &upload_id).await?;
    }

    Ok(cancelled)
}

#[tauri::command]
pub(crate) fn finish_upload_task(
    state: State<'_, UploadTransferState>,
    task_id: String,
) -> Result<(), ApiCommandError> {
    state.finish(&task_id)
}

#[tauri::command]
pub(crate) async fn run_upload_task(
    api_state: State<'_, ApiState>,
    upload_state: State<'_, UploadTransferState>,
    input: UploadRunInput,
    on_progress: Channel<UploadTransferEvent>,
) -> Result<UploadRunResult, ApiCommandError> {
    upload_transfer::run_upload_task(api_state.inner(), upload_state.inner(), input, on_progress)
        .await
}

#[tauri::command]
pub(crate) async fn update_avatar(
    state: State<'_, ApiState>,
    path: String,
) -> Result<AvatarInfo, ApiCommandError> {
    settings_transfer::update_avatar(state.inner(), path).await
}

#[tauri::command]
pub(crate) async fn load_avatar(
    state: State<'_, ApiState>,
    user_id: Option<String>,
) -> Result<Option<AvatarPayload>, ApiCommandError> {
    settings_transfer::load_avatar(state.inner(), user_id).await
}

#[tauri::command]
pub(crate) async fn save_recovery_codes(
    destination: String,
    codes: Vec<String>,
) -> Result<(), ApiCommandError> {
    settings_transfer::save_recovery_codes(destination, codes).await
}
