mod api;
mod commands;
mod file_transfer;
mod session;
mod upload_transfer;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(api::ApiState::default())
        .manage(upload_transfer::UploadTransferState::default())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("discloud", |context, request, responder| {
            file_transfer::respond_file_protocol(context.app_handle().clone(), request, responder);
        })
        .invoke_handler(tauri::generate_handler![
            commands::api_request,
            commands::connect_server,
            commands::disconnect_server,
            commands::download_file,
            commands::inspect_upload_files,
            commands::begin_upload_task,
            commands::cancel_upload_task,
            commands::finish_upload_task,
            commands::upload_file_part,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DisCloud");
}
