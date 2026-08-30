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
use std::path::Path;
use std::process::Command;

fn sanitize_child_environment(command: &mut Command) {
    // AppImage injects runtime paths that must not leak into an ordinary user
    // terminal or provider login process. In particular, inherited PYTHONHOME
    // makes the system Python search the extracted AppImage for its stdlib.
    for key in ["APPDIR", "APPIMAGE", "ARGV0", "OWD", "PYTHONHOME", "PYTHONPATH", "LD_LIBRARY_PATH"] {
        command.env_remove(key);
    }
}

fn safe_directory(directory: Option<String>) -> Option<String> {
    let requested = directory.filter(|path| Path::new(path).is_absolute() && !path.contains("appimage_extracted_"));
    requested.or_else(|| std::env::var("HOME").ok()).or_else(|| std::env::var("USERPROFILE").ok())
}

#[tauri::command]
fn home_directory() -> Result<String, String> {
    safe_directory(None).ok_or_else(|| "Could not determine the user home directory".into())
}

/// Relay one IPC envelope from the UI to lawd and return the response envelope.
/// Blocking socket I/O runs on a blocking task to keep the UI responsive.
#[tauri::command]
async fn law_ipc(request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || daemon_client::relay(request))
        .await
        .map_err(|e| format!("ipc relay task failed: {e}"))
}

/// Open an attended system terminal in the current workspace. This launches
/// the platform terminal only; command execution remains under human control.
#[tauri::command]
fn open_terminal(directory: Option<String>) -> Result<String, String> {
    let cwd = safe_directory(directory);

    #[cfg(target_os = "linux")]
    {
        let candidates: [(&str, &[&str]); 4] = [
            ("x-terminal-emulator", &[]),
            ("gnome-terminal", &[]),
            ("konsole", &[]),
            ("xfce4-terminal", &[]),
        ];
        for (program, args) in candidates {
            let mut command = Command::new(program);
            command.args(args);
            sanitize_child_environment(&mut command);
            if let Some(path) = &cwd { command.current_dir(path); }
            if command.spawn().is_ok() { return Ok(program.to_string()); }
        }
        return Err("No supported terminal application was found".into());
    }

    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        command.args(["-a", "Terminal"]);
        sanitize_child_environment(&mut command);
        if let Some(path) = &cwd { command.arg(path); }
        command.spawn().map_err(|error| error.to_string())?;
        return Ok("Terminal".into());
    }

    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", "powershell.exe"]);
        sanitize_child_environment(&mut command);
        if let Some(path) = &cwd { command.current_dir(path); }
        command.spawn().map_err(|error| error.to_string())?;
        return Ok("PowerShell".into());
    }

    #[allow(unreachable_code)]
    Err("Terminal launching is not supported on this platform".into())
}

/// Hand provider authentication to LAW Core in an attended terminal. Provider
/// credentials remain owned by the provider/Pi login flow and never enter UI IPC.
#[tauri::command]
fn provider_login(provider: String, directory: Option<String>) -> Result<String, String> {
    if !provider.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-') {
        return Err("Invalid provider identifier".into());
    }
    let cwd = safe_directory(directory);

    #[cfg(target_os = "linux")]
    {
        let script = format!("law provider login {provider}; printf '\\nPress Enter to close…'; read _");
        let candidates: [(&str, Vec<&str>); 3] = [
            ("gnome-terminal", vec!["--", "bash", "-lc", &script]),
            ("konsole", vec!["-e", "bash", "-lc", &script]),
            ("x-terminal-emulator", vec!["-e", "bash", "-lc", &script]),
        ];
        for (program, args) in candidates {
            let mut command = Command::new(program);
            command.args(args);
            sanitize_child_environment(&mut command);
            if let Some(path) = &cwd { command.current_dir(path); }
            if command.spawn().is_ok() { return Ok(program.to_string()); }
        }
        return Err("No supported terminal application was found for provider login".into());
    }

    #[cfg(target_os = "macos")]
    {
        let script = format!("tell application \"Terminal\" to do script \"law provider login {provider}\"");
        let mut command = Command::new("osascript");
        command.args(["-e", &script]); sanitize_child_environment(&mut command);
        command.spawn().map_err(|error| error.to_string())?;
        return Ok("Terminal".into());
    }

    #[cfg(target_os = "windows")]
    {
        let command = format!("start powershell.exe -NoExit law provider login {provider}");
        let mut process = Command::new("cmd"); process.args(["/C", &command]); sanitize_child_environment(&mut process);
        process.spawn().map_err(|error| error.to_string())?;
        return Ok("PowerShell".into());
    }

    #[allow(unreachable_code)]
    Err("Provider login is not supported on this platform".into())
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
        .invoke_handler(tauri::generate_handler![law_ipc, home_directory, open_terminal, provider_login])
        .run(tauri::generate_context!())
        .expect("error while running LAW desktop");
}
