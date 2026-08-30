//! LAW desktop Tauri shell.
//!
//! The shell owns window lifecycle, secure IPC bootstrap, OS dialogs, update
//! restart, and narrow native capabilities only. It does NOT execute provider
//! calls, shell commands, Git mutations, files, or credential retrieval — those
//! belong to lawd. The `law_ipc` command relays a validated envelope to lawd
//! over the authenticated local socket.

mod daemon_client;
mod daemon_runtime;

use serde_json::Value;

/// Relay one IPC envelope from the UI to lawd and return the response envelope.
/// Blocking socket I/O runs on a blocking task to keep the UI responsive.
#[tauri::command]
async fn law_ipc(request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || daemon_client::relay(request))
        .await
        .map_err(|e| format!("ipc relay task failed: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            daemon_runtime::start(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![law_ipc])
        .run(tauri::generate_context!())
        .expect("error while running LAW desktop");
}
