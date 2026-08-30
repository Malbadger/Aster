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
use serde::Serialize;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::Command;
use std::sync::{atomic::{AtomicU64, Ordering}, Mutex};
use tauri::{Emitter, State};

static TERMINAL_SEQUENCE: AtomicU64 = AtomicU64::new(1);

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
struct TerminalState(Mutex<HashMap<String, TerminalSession>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput { session_id: String, data: String }

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

#[tauri::command]
fn terminal_start(app: tauri::AppHandle, state: State<'_, TerminalState>, directory: Option<String>, cols: u16, rows: u16, program: Option<String>, file_path: Option<String>) -> Result<String, String> {
    let pair = native_pty_system().openpty(PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 })
        .map_err(|error| format!("Could not allocate terminal: {error}"))?;
    let mut command = if program.as_deref() == Some("neovim") {
        let path = file_path.filter(|value| Path::new(value).is_absolute()).ok_or_else(|| "Neovim requires an absolute file path".to_string())?;
        let mut command = CommandBuilder::new("nvim"); command.arg("--"); command.arg(path); command
    } else {
        let shell = std::env::var("SHELL").ok().filter(|value| Path::new(value).is_absolute()).unwrap_or_else(|| "/bin/bash".into());
        CommandBuilder::new(shell)
    };
    command.cwd(safe_directory(directory).unwrap_or_else(|| "/".into()));
    command.env("TERM", "xterm-256color");
    for key in ["APPDIR", "APPIMAGE", "ARGV0", "OWD", "PYTHONHOME", "PYTHONPATH", "LD_LIBRARY_PATH"] { command.env_remove(key); }
    let child = pair.slave.spawn_command(command).map_err(|error| format!("Could not start shell: {error}"))?;
    let mut reader = pair.master.try_clone_reader().map_err(|error| format!("Could not read terminal: {error}"))?;
    let writer = pair.master.take_writer().map_err(|error| format!("Could not write terminal: {error}"))?;
    let session_id = format!("terminal-{}", TERMINAL_SEQUENCE.fetch_add(1, Ordering::Relaxed));
    let output_id = session_id.clone();
    std::thread::spawn(move || {
        let mut bytes = [0_u8; 8192];
        while let Ok(count) = reader.read(&mut bytes) {
            if count == 0 { break; }
            let _ = app.emit("terminal-output", TerminalOutput { session_id: output_id.clone(), data: String::from_utf8_lossy(&bytes[..count]).into_owned() });
        }
    });
    state.0.lock().map_err(|_| "Terminal state is unavailable".to_string())?
        .insert(session_id.clone(), TerminalSession { master: pair.master, writer, child });
    Ok(session_id)
}

#[tauri::command]
fn editor_open(engine: String, file_path: String) -> Result<String, String> {
    if !Path::new(&file_path).is_absolute() { return Err("Editor paths must be absolute".into()); }
    let candidates: &[&str] = match engine.as_str() {
        "vscode-oss" => &["codium", "code-oss"],
        _ => return Err("Unsupported external editor".into()),
    };
    for program in candidates {
        let mut command = Command::new(program); command.arg("--reuse-window").arg(&file_path); sanitize_child_environment(&mut command);
        if command.spawn().is_ok() { return Ok((*program).into()); }
    }
    Err("VSCodium or VS Code OSS is not installed or not available on PATH".into())
}

#[tauri::command]
fn terminal_write(state: State<'_, TerminalState>, session_id: String, data: String) -> Result<(), String> {
    let mut sessions = state.0.lock().map_err(|_| "Terminal state is unavailable".to_string())?;
    let session = sessions.get_mut(&session_id).ok_or_else(|| "Terminal session was not found".to_string())?;
    session.writer.write_all(data.as_bytes()).and_then(|_| session.writer.flush()).map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_resize(state: State<'_, TerminalState>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.0.lock().map_err(|_| "Terminal state is unavailable".to_string())?;
    let session = sessions.get(&session_id).ok_or_else(|| "Terminal session was not found".to_string())?;
    session.master.resize(PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 }).map_err(|error| error.to_string())
}

#[tauri::command]
fn terminal_stop(state: State<'_, TerminalState>, session_id: String) -> Result<(), String> {
    let mut session = state.0.lock().map_err(|_| "Terminal state is unavailable".to_string())?
        .remove(&session_id).ok_or_else(|| "Terminal session was not found".to_string())?;
    session.child.kill().map_err(|error| error.to_string())
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
        .manage(TerminalState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            daemon_runtime::start(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![law_ipc, home_directory, open_terminal, provider_login, editor_open, terminal_start, terminal_write, terminal_resize, terminal_stop])
        .run(tauri::generate_context!())
        .expect("error while running LAW desktop");
}
