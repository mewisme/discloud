use tauri::State;

use crate::{
    api::{ApiCommandError, ApiRequest, ApiResponse, ApiState, ConnectedServer},
    file_transfer::{self, DownloadResult},
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
