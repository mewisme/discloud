use tauri::{AppHandle, State};

use crate::{
    api::{ApiCommandError, ApiRequest, ApiResponse, ApiState, ConnectedServer},
    file_transfer::{self, DownloadResult},
    settings_transfer::{self, AvatarInfo, AvatarPayload},
    upload_engine::{self, UploadEngineState, UploadSnapshot},
    upload_transfer::UploadTransferState,
};

#[tauri::command]
pub(crate) async fn connect_server(
    state: State<'_, ApiState>,
    server_url: String,
) -> Result<ConnectedServer, ApiCommandError> {
    state.connect(server_url).await
}

#[tauri::command]
pub(crate) async fn disconnect_server(
    app: AppHandle,
    api_state: State<'_, ApiState>,
    upload_state: State<'_, UploadTransferState>,
    upload_engine_state: State<'_, UploadEngineState>,
) -> Result<(), ApiCommandError> {
    upload_engine::reset(
        &app,
        api_state.inner(),
        upload_state.inner(),
        upload_engine_state.inner(),
    )
    .await?;

    api_state.disconnect()
}

#[tauri::command]
pub(crate) async fn api_request(
    app: AppHandle,
    api_state: State<'_, ApiState>,
    upload_state: State<'_, UploadTransferState>,
    upload_engine_state: State<'_, UploadEngineState>,
    request: ApiRequest,
) -> Result<ApiResponse, ApiCommandError> {
    let logout = request.is_logout();
    let session_check = request.is_session_check();

    if logout {
        upload_engine::reset(
            &app,
            api_state.inner(),
            upload_state.inner(),
            upload_engine_state.inner(),
        )
        .await?;
    }

    let result = api_state.request(request).await;

    if session_check && result.as_ref().err().is_some_and(|error| error.is_unauthorized()) {
        let _ = upload_engine::reset(
            &app,
            api_state.inner(),
            upload_state.inner(),
            upload_engine_state.inner(),
        )
        .await;
    }

    result
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
pub(crate) fn get_upload_snapshot(
    state: State<'_, UploadEngineState>,
) -> Result<UploadSnapshot, ApiCommandError> {
    state.snapshot()
}

#[tauri::command]
pub(crate) async fn add_upload_paths(
    app: AppHandle,
    api_state: State<'_, ApiState>,
    upload_state: State<'_, UploadTransferState>,
    upload_engine_state: State<'_, UploadEngineState>,
    folder_id: String,
    paths: Vec<String>,
) -> Result<(), ApiCommandError> {
    upload_engine::add_paths(
        app,
        api_state.inner().clone(),
        upload_state.inner().clone(),
        upload_engine_state.inner().clone(),
        folder_id,
        paths,
    )
    .await
}

#[tauri::command]
pub(crate) fn retry_upload_task(
    app: AppHandle,
    api_state: State<'_, ApiState>,
    upload_state: State<'_, UploadTransferState>,
    upload_engine_state: State<'_, UploadEngineState>,
    task_id: String,
) -> Result<(), ApiCommandError> {
    upload_engine::retry(
        app,
        api_state.inner().clone(),
        upload_state.inner().clone(),
        upload_engine_state.inner().clone(),
        task_id,
    )
}

#[tauri::command]
pub(crate) async fn cancel_upload_task(
    app: AppHandle,
    api_state: State<'_, ApiState>,
    upload_state: State<'_, UploadTransferState>,
    upload_engine_state: State<'_, UploadEngineState>,
    task_id: String,
) -> Result<(), ApiCommandError> {
    upload_engine::cancel(
        app,
        api_state.inner().clone(),
        upload_state.inner().clone(),
        upload_engine_state.inner().clone(),
        task_id,
    )
    .await
}

#[tauri::command]
pub(crate) fn remove_upload_task(
    app: AppHandle,
    upload_engine_state: State<'_, UploadEngineState>,
    task_id: String,
) -> Result<(), ApiCommandError> {
    upload_engine::remove(app, upload_engine_state.inner().clone(), task_id)
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
