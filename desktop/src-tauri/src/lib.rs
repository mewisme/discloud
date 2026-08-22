mod api;
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(api::ApiState::default())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::api_request,
            commands::connect_server,
            commands::disconnect_server,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DisCloud");
}
