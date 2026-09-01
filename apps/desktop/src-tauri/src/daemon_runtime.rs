//! Owns the `lawd` child process for the lifetime of the desktop application.
//! The packaged application carries a private Node runtime and daemon payload;
//! development builds fall back to the repository's configured Node executable.

use std::env;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

pub struct LawdChild(Mutex<Option<Child>>);

impl Drop for LawdChild {
    fn drop(&mut self) {
        if let Ok(slot) = self.0.get_mut() {
            if let Some(child) = slot.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn packaged_paths(app: &AppHandle) -> Option<(PathBuf, PathBuf, PathBuf)> {
    let resources = app.path().resource_dir().ok()?;
    let root = resources.join("runtime/app");
    let node = resources.join("runtime/node");
    let entry = root.join("apps/lawd/dist/main.js");
    (node.is_file() && entry.is_file()).then_some((node, entry, root))
}

fn development_paths() -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let start = env::current_dir().map_err(|error| format!("cannot determine working directory: {error}"))?;
    let root = start.ancestors().find(|path| path.join("apps/lawd/dist/main.js").is_file()).map(Path::to_path_buf)
        .ok_or_else(|| format!("lawd is not built in {} or an ancestor", start.display()))?;
    let entry = root.join("apps/lawd/dist/main.js");
    let node = env::var_os("LAW_NODE").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("node"));
    Ok((node, entry, root))
}

fn handshake_path() -> PathBuf {
    let base = env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).unwrap_or_else(env::temp_dir);
    base.join("law/lawd.json")
}

fn wait_for_handshake(child: &mut Child, path: &Path) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(12);
    while Instant::now() < deadline {
        if path.is_file() { return Ok(()); }
        if let Some(status) = child.try_wait().map_err(|error| format!("cannot inspect lawd: {error}"))? {
            return Err(format!("lawd exited during startup with {status}"));
        }
        thread::sleep(Duration::from_millis(80));
    }
    Err("lawd did not become ready within 12 seconds".to_string())
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    let (node, entry, root) = packaged_paths(app).map_or_else(development_paths, Ok)?;
    let handshake = handshake_path();
    let _ = std::fs::remove_file(&handshake);
    let data_dir = app.path().app_data_dir().map_err(|error| format!("cannot determine Aster data directory: {error}"))?;
    std::fs::create_dir_all(&data_dir).map_err(|error| format!("cannot create Aster data directory: {error}"))?;
    let mut command = Command::new(&node);
    command.arg(&entry).current_dir(&root).env("LAW_DATA_DIR", &data_dir)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    let mut child = command.spawn()
        .map_err(|error| format!("cannot start Aster local service with {}: {error}", node.display()))?;
    if let Err(error) = wait_for_handshake(&mut child, &handshake) {
        let _ = child.kill();
        return Err(error);
    }
    app.manage(LawdChild(Mutex::new(Some(child))));
    Ok(())
}
