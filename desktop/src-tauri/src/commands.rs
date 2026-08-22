use tauri::State;

use crate::api::{ApiCommandError, ApiRequest, ApiResponse, ApiState, ConnectedServer};

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
