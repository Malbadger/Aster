//! Aster desktop Tauri shell.
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
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{atomic::{AtomicU64, Ordering}, Mutex};
use tauri::{Emitter, Manager, State};
#[cfg(unix)]
use std::os::unix::process::CommandExt;

static TERMINAL_SEQUENCE: AtomicU64 = AtomicU64::new(1);

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
struct TerminalState(Mutex<HashMap<String, TerminalSession>>);

struct VscodiumServer {
    child: std::process::Child,
    theme_proxy: std::process::Child,
    url: String,
    folder: String,
}

#[derive(Default)]
struct VscodiumState(Mutex<Option<VscodiumServer>>);

impl Drop for VscodiumState {
    fn drop(&mut self) {
        if let Ok(slot) = self.0.get_mut() {
            if let Some(server) = slot.as_mut() {
                terminate_process_group(&mut server.theme_proxy);
                terminate_process_group(&mut server.child);
            }
        }
    }
}

fn terminate_process_group(child: &mut std::process::Child) {
    #[cfg(unix)]
    unsafe { libc::kill(-(child.id() as i32), libc::SIGTERM); }
    #[cfg(not(unix))]
    { let _ = child.kill(); }
    let _ = child.wait();
}

fn executable_in_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|path| {
        std::env::split_paths(&path).map(|dir| dir.join(name)).find(|candidate| candidate.is_file())
    })
}

fn find_vscodium_tunnel() -> Option<PathBuf> {
    if let Some(direct) = executable_in_path("codium-tunnel") { return Some(direct); }
    for launcher in ["codium", "code-oss"] {
        let Some(path) = executable_in_path(launcher) else { continue };
        let resolved = std::fs::canonicalize(path).ok()?;
        let sibling = resolved.parent()?.join("codium-tunnel");
        if sibling.is_file() { return Some(sibling); }
    }
    None
}

fn wait_for_vscodium_http(url: &str, timeout: std::time::Duration) -> Result<(), String> {
    let authority = url.strip_prefix("http://127.0.0.1:").ok_or_else(|| "VSCodium published a non-loopback URL".to_string())?;
    let port = authority.split('/').next().and_then(|value| value.parse::<u16>().ok()).ok_or_else(|| "VSCodium published an invalid port".to_string())?;
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if let Ok(mut stream) = TcpStream::connect_timeout(&address, std::time::Duration::from_millis(300)) {
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(500)));
            if stream.write_all(b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").is_ok() {
                let mut response = [0_u8; 32];
                if let Ok(count) = stream.read(&mut response) {
                    if response[..count].starts_with(b"HTTP/1.1 200") { return Ok(()); }
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    Err("VSCodium did not become HTTP-ready".into())
}

fn vscodium_theme_name(theme: Option<&str>) -> &'static str {
    match theme.unwrap_or("graphite") {
        "light" => "Aster Paper",
        "midnight" => "Aster Midnight",
        "high-contrast" => "Aster High Contrast",
        "dracula" => "Dracula",
        "one-dark-pro" => "One Dark Pro",
        "monokai" => "Monokai",
        "solarized-dark" => "Solarized Dark",
        "solarized-light" => "Solarized Light",
        "nord" => "Nord",
        "gruvbox-dark" => "Gruvbox Dark",
        "github-dark" => "GitHub Dark",
        "github-light" => "GitHub Light",
        "tokyo-night" => "Tokyo Night",
        "night-owl" => "Night Owl",
        "catppuccin-mocha" => "Catppuccin Mocha",
        "synthwave-84" => "Synthwave 84",
        "atom-one-light" => "Atom One Light",
        _ => "Aster Graphite",
    }
}

fn vscodium_theme_id(theme: Option<&str>) -> &'static str {
    match theme.unwrap_or("graphite") {
        "light" => "light",
        "midnight" => "midnight",
        "high-contrast" => "high-contrast",
        "dracula" => "dracula",
        "one-dark-pro" => "one-dark-pro",
        "monokai" => "monokai",
        "solarized-dark" => "solarized-dark",
        "solarized-light" => "solarized-light",
        "nord" => "nord",
        "gruvbox-dark" => "gruvbox-dark",
        "github-dark" => "github-dark",
        "github-light" => "github-light",
        "tokyo-night" => "tokyo-night",
        "night-owl" => "night-owl",
        "catppuccin-mocha" => "catppuccin-mocha",
        "synthwave-84" => "synthwave-84",
        "atom-one-light" => "atom-one-light",
        _ => "graphite",
    }
}

fn themed_vscodium_url(url: &str, theme: Option<&str>) -> String {
    format!("{}?lawTheme={}", url.trim_end_matches('/'), vscodium_theme_id(theme))
}

fn spawn_vscodium_theme_proxy(app: &tauri::AppHandle, upstream: &str) -> Result<(std::process::Child, String), String> {
    let resources = app.path().resource_dir().map_err(|error| error.to_string())?;
    let node = resources.join("runtime/node");
    let script = resources.join("vscodium-theme-proxy.mjs");
    let theme_directory = app.path().app_data_dir().map_err(|error| error.to_string())?
        .join("vscodium-server/extensions/law.law-workbench-themes-1.2.0/themes");
    if !node.is_file() || !script.is_file() { return Err("The bundled Aster VSCodium theme proxy is missing".into()); }
    if !theme_directory.is_dir() { return Err("The installed Aster VSCodium themes are missing".into()); }
    let mut command = Command::new(node);
    command.arg(script).arg(upstream).arg(theme_directory)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    sanitize_child_environment(&mut command);
    let mut child = command.spawn().map_err(|error| format!("Could not start Aster VSCodium theme proxy: {error}"))?;
    let stdout = child.stdout.take().ok_or_else(|| "Could not read Aster VSCodium theme proxy output".to_string())?;
    let stderr = child.stderr.take();
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut published = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if !published && line.starts_with("http://127.0.0.1:") {
                let _ = sender.send(line);
                published = true;
            }
        }
    });
    if let Some(mut stderr) = stderr { std::thread::spawn(move || { let _ = std::io::copy(&mut stderr, &mut std::io::sink()); }); }
    match receiver.recv_timeout(std::time::Duration::from_secs(10)) {
        Ok(url) => {
            if let Err(error) = wait_for_vscodium_http(&url, std::time::Duration::from_secs(10)) {
                terminate_process_group(&mut child);
                return Err(format!("Aster VSCodium theme proxy failed readiness: {error}"));
            }
            Ok((child, url))
        }
        Err(_) => {
            terminate_process_group(&mut child);
            Err("Aster VSCodium theme proxy did not publish its local URL".into())
        }
    }
}

fn prepare_vscodium_profile(app: &tauri::AppHandle, program: &Path, data_dir: &Path, theme: Option<&str>) -> Result<(), String> {
    let bundled = app.path().resource_dir().map_err(|error| error.to_string())?.join("law-workbench-themes.vsix");
    if !bundled.is_file() { return Err("The bundled Aster editor themes are missing".into()); }

    let extensions = data_dir.join("extensions");
    let installed = extensions.join("law.law-workbench-themes-1.2.0/package.json");
    let registered = std::fs::read_to_string(extensions.join("extensions.json"))
        .map(|contents| contents.contains("law.law-workbench-themes"))
        .unwrap_or(false);
    if !installed.is_file() || !registered {
        std::fs::create_dir_all(&extensions).map_err(|error| format!("Could not create Aster theme extension directory: {error}"))?;
        let mut install = Command::new(program);
        install.arg("--extensions-dir").arg(&extensions)
            .arg("--install-extension").arg(&bundled).arg("--force");
        sanitize_child_environment(&mut install);
        let output = install.output().map_err(|error| format!("Could not start the VSCodium theme installer: {error}"))?;
        if !output.status.success() {
            return Err(format!("Could not install Aster editor themes: {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
    }

    let settings_path = data_dir.join("data/User/settings.json");
    let settings_dir = settings_path.parent().ok_or_else(|| "Could not resolve VSCodium settings directory".to_string())?;
    std::fs::create_dir_all(settings_dir).map_err(|error| format!("Could not create VSCodium settings directory: {error}"))?;
    let mut settings = if settings_path.is_file() {
        serde_json::from_slice::<Value>(&std::fs::read(&settings_path).map_err(|error| error.to_string())?)
            .map_err(|error| format!("VSCodium settings are not valid JSON: {error}"))?
    } else {
        Value::Object(serde_json::Map::new())
    };
    let object = settings.as_object_mut().ok_or_else(|| "VSCodium settings must contain a JSON object".to_string())?;
    object.insert("workbench.colorTheme".into(), Value::String(vscodium_theme_name(theme).into()));
    object.insert("window.autoDetectColorScheme".into(), Value::Bool(false));
    let temporary = settings_path.with_extension("json.law-tmp");
    std::fs::write(&temporary, serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?)
        .map_err(|error| format!("Could not write VSCodium theme setting: {error}"))?;
    std::fs::rename(&temporary, &settings_path).map_err(|error| format!("Could not activate VSCodium theme setting: {error}"))?;
    Ok(())
}

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

/// Open a provider-owned authentication page in the user's default browser.
/// This deliberately accepts only ordinary HTTP(S) URLs; no file, shell, or
/// custom schemes can cross the webview/native boundary.
#[tauri::command]
fn open_external_url(url: String) -> Result<String, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) || url.contains(['\n', '\r', '\0']) {
        return Err("Only HTTP(S) authentication URLs can be opened".into());
    }

    #[cfg(target_os = "linux")]
    {
        for (program, args) in [("xdg-open", vec![url.as_str()]), ("gio", vec!["open", url.as_str()])] {
            let mut command = Command::new(program); command.args(args); sanitize_child_environment(&mut command);
            if command.spawn().is_ok() { return Ok(program.into()); }
        }
        return Err("No supported browser opener was found".into());
    }

    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open"); command.arg(&url); sanitize_child_environment(&mut command);
        command.spawn().map_err(|error| error.to_string())?; return Ok("open".into());
    }

    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("cmd"); command.args(["/C", "start", "", &url]); sanitize_child_environment(&mut command);
        command.spawn().map_err(|error| error.to_string())?; return Ok("default browser".into());
    }

    #[allow(unreachable_code)]
    Err("Opening a browser is not supported on this platform".into())
}

fn bundled_pi_command(app: &tauri::AppHandle) -> Option<CommandBuilder> {
    let resources = app.path().resource_dir().ok()?;
    let node = resources.join("runtime/node");
    let cli = resources.join("runtime/app/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
    if !node.is_file() || !cli.is_file() { return None; }
    let mut command = CommandBuilder::new(node);
    command.arg(cli);
    Some(command)
}

fn bundled_gemini_command(app: &tauri::AppHandle) -> Option<CommandBuilder> {
    let resources = app.path().resource_dir().ok()?;
    let node = resources.join("runtime/node");
    let cli = resources.join("runtime/app/node_modules/@google/gemini-cli/bundle/gemini.js");
    if !node.is_file() || !cli.is_file() { return None; }
    let mut command = CommandBuilder::new(node);
    command.arg(cli);
    command.arg("--skip-trust");
    command.env("GOOGLE_GENAI_USE_GCA", "true");
    Some(command)
}

#[tauri::command]
fn terminal_start(app: tauri::AppHandle, state: State<'_, TerminalState>, directory: Option<String>, cols: u16, rows: u16, program: Option<String>) -> Result<String, String> {
    let pair = native_pty_system().openpty(PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 })
        .map_err(|error| format!("Could not allocate terminal: {error}"))?;
    let mut command = if program.as_deref() == Some("pi") {
        bundled_pi_command(&app).unwrap_or_else(|| CommandBuilder::new("pi"))
    } else if program.as_deref() == Some("gemini") {
        bundled_gemini_command(&app).unwrap_or_else(|| CommandBuilder::new("gemini"))
    } else if program.as_deref() == Some("antigravity") {
        let home = std::env::var("HOME").unwrap_or_default();
        let local = Path::new(&home).join(".local/bin/agy");
        if local.is_file() { CommandBuilder::new(local) } else { CommandBuilder::new("agy") }
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
fn vscodium_start(app: tauri::AppHandle, state: State<'_, VscodiumState>, directory: Option<String>, theme: Option<String>) -> Result<String, String> {
    ensure_vscodium(&app, &state, directory, theme)
}

fn ensure_vscodium(app: &tauri::AppHandle, state: &VscodiumState, directory: Option<String>, theme: Option<String>) -> Result<String, String> {
    let mut slot = state.0.lock().map_err(|_| "VSCodium state is unavailable".to_string())?;
    let folder = safe_directory(directory).ok_or_else(|| "Could not determine a VSCodium workspace".to_string())?;
    let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?.join("vscodium-server");
    std::fs::create_dir_all(&data_dir).map_err(|error| format!("Could not create VSCodium data directory: {error}"))?;
    let program = find_vscodium_tunnel().ok_or_else(|| "Could not find the VSCodium server executable (codium-tunnel)".to_string())?;
    prepare_vscodium_profile(app, &program, &data_dir, theme.as_deref())?;
    if let Some(server) = slot.as_mut() {
        let editor_running = server.child.try_wait().map_err(|error| error.to_string())?.is_none();
        let proxy_running = server.theme_proxy.try_wait().map_err(|error| error.to_string())?.is_none();
        if editor_running && proxy_running && server.folder == folder {
            return Ok(themed_vscodium_url(&server.url, theme.as_deref()));
        }
        terminate_process_group(&mut server.theme_proxy);
        terminate_process_group(&mut server.child);
        *slot = None;
    }
    let mut command = Command::new(&program);
    command.args(["serve-web", "--host", "127.0.0.1", "--port", "0", "--without-connection-token", "--accept-server-license-terms", "--disable-telemetry", "--server-data-dir"])
        .arg(&data_dir).arg("--default-folder").arg(&folder)
        .env("VSCODE_EXTENSIONS", data_dir.join("extensions"))
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    sanitize_child_environment(&mut command);
    match command.spawn() {
        Ok(mut child) => {
            let stdout = child.stdout.take().ok_or_else(|| "Could not read VSCodium startup output".to_string())?;
            let stderr = child.stderr.take();
            let (sender, receiver) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let mut published = false;
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if !published {
                        if let Some(url) = line.split_whitespace().find(|part| part.starts_with("http://127.0.0.1:")) {
                            let _ = sender.send(url.to_string());
                            published = true;
                        }
                    }
                }
            });
            if let Some(mut stderr) = stderr { std::thread::spawn(move || { let _ = std::io::copy(&mut stderr, &mut std::io::sink()); }); }
            match receiver.recv_timeout(std::time::Duration::from_secs(20)) {
                Ok(url) => match wait_for_vscodium_http(&url, std::time::Duration::from_secs(20)) {
                    Ok(()) => match spawn_vscodium_theme_proxy(app, &url) {
                        Ok((theme_proxy, proxy_url)) => {
                            let themed_url = themed_vscodium_url(&proxy_url, theme.as_deref());
                            *slot = Some(VscodiumServer { child, theme_proxy, url: proxy_url, folder: folder.clone() });
                            return Ok(themed_url);
                        }
                        Err(error) => { terminate_process_group(&mut child); return Err(error); }
                    },
                    Err(error) => { terminate_process_group(&mut child); return Err(error); }
                },
                Err(_) => { terminate_process_group(&mut child); return Err(format!("{} did not publish its local URL", program.display())); }
            }
        }
        Err(error) => return Err(format!("{}: {error}", program.display())),
    }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TerminalState::default())
        .manage(VscodiumState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            daemon_runtime::start(app.handle()).map_err(std::io::Error::other)?;
            // Start the loopback VSCodium host with Aster itself. This hides the
            // one-time server initialization behind ordinary application use,
            // while the editor command can still retry or switch workspaces.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let state = handle.state::<VscodiumState>();
                let _ = ensure_vscodium(&handle, &state, None, Some("graphite".into()));
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![law_ipc, home_directory, open_external_url, open_terminal, editor_open, vscodium_start, terminal_start, terminal_write, terminal_resize, terminal_stop])
        .run(tauri::generate_context!())
        .expect("error while running Aster desktop");
}

#[cfg(test)]
mod tests {
    use super::vscodium_theme_name;

    #[test]
    fn maps_law_theme_ids_to_editor_theme_labels() {
        assert_eq!(vscodium_theme_name(Some("graphite")), "Aster Graphite");
        assert_eq!(vscodium_theme_name(Some("light")), "Aster Paper");
        assert_eq!(vscodium_theme_name(Some("catppuccin-mocha")), "Catppuccin Mocha");
        assert_eq!(vscodium_theme_name(Some("not-a-theme")), "Aster Graphite");
    }
}
