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

fn runtime_revision(resources: &Path) -> String {
    let manifest = resources.join("runtime/manifest.json");
    std::fs::read(&manifest).ok()
        .and_then(|raw| serde_json::from_slice::<serde_json::Value>(&raw).ok())
        .and_then(|value| value.get("runtimeRevision")?.as_str().map(str::to_owned))
        .unwrap_or_else(|| "unversioned".to_string())
}

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

pub fn packaged_app_root(app: &AppHandle) -> Option<PathBuf> {
    let data_dir = app.path().app_data_dir().ok()?;
    let root = data_dir.join("runtime/app-0.1.0");
    root.join(".aster-ready").is_file().then_some(root)
}

fn prepare_packaged_app(app: &AppHandle, data_dir: &Path) -> Result<Option<PathBuf>, String> {
    let resources = app.path().resource_dir().map_err(|error| format!("cannot determine Aster resources: {error}"))?;
    let archive = resources.join("runtime/app.tar.gz");
    if !archive.is_file() { return Ok(None); }
    let root = data_dir.join("runtime/app-0.1.0");
    let marker = root.join(".aster-ready");
    let expected = format!("aster-runtime={}\n", runtime_revision(&resources));
    if std::fs::read_to_string(&marker).ok().as_deref() != Some(expected.as_str()) {
        if root.exists() { std::fs::remove_dir_all(&root).map_err(|error| format!("cannot replace Aster runtime: {error}"))?; }
        std::fs::create_dir_all(&root).map_err(|error| format!("cannot create Aster runtime: {error}"))?;
        let status = Command::new("tar").arg("-xzf").arg(&archive).arg("-C").arg(&root).status()
            .map_err(|error| format!("cannot extract Aster runtime: {error}"))?;
        if !status.success() { return Err(format!("Aster runtime extraction failed with {status}")); }
        std::fs::write(&marker, expected)
            .map_err(|error| format!("cannot finalize Aster runtime: {error}"))?;
    }
    Ok(Some(root))
}

fn packaged_paths(app: &AppHandle, data_dir: &Path) -> Result<Option<(PathBuf, PathBuf, PathBuf)>, String> {
    let resources = app.path().resource_dir().map_err(|error| format!("cannot determine Aster resources: {error}"))?;
    let Some(root) = prepare_packaged_app(app, data_dir)? else { return Ok(None); };
    let node = resources.join("runtime/node");
    let entry = root.join("apps/lawd/dist/main.js");
    Ok((node.is_file() && entry.is_file()).then_some((node, entry, root)))
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

fn prepare_antigravity_sdk(app: &AppHandle, data_dir: &Path) -> Result<Option<PathBuf>, String> {
    let resources = app.path().resource_dir().map_err(|error| format!("cannot determine Aster resources: {error}"))?;
    let archive = resources.join("runtime/antigravity-python.tar.gz");
    if !archive.is_file() { return Ok(None); }
    let target = data_dir.join("runtime/antigravity-python-0.1.16");
    let marker = target.join(".aster-ready");
    let expected = format!("google-antigravity=0.1.16:{}\n", runtime_revision(&resources));
    if std::fs::read_to_string(&marker).ok().as_deref() != Some(expected.as_str()) {
        if target.exists() { std::fs::remove_dir_all(&target).map_err(|error| format!("cannot replace Antigravity SDK runtime: {error}"))?; }
        std::fs::create_dir_all(&target).map_err(|error| format!("cannot create Antigravity SDK runtime: {error}"))?;
        let status = Command::new("tar").arg("-xzf").arg(&archive).arg("-C").arg(&target).status()
            .map_err(|error| format!("cannot extract Antigravity SDK runtime: {error}"))?;
        if !status.success() { return Err(format!("Antigravity SDK runtime extraction failed with {status}")); }
        std::fs::write(&marker, expected)
            .map_err(|error| format!("cannot finalize Antigravity SDK runtime: {error}"))?;
    }
    Ok(Some(target))
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|error| format!("cannot determine Aster data directory: {error}"))?;
    std::fs::create_dir_all(&data_dir).map_err(|error| format!("cannot create Aster data directory: {error}"))?;
    let (node, entry, root) = match packaged_paths(app, &data_dir)? {
        Some(paths) => paths,
        None => development_paths()?,
    };
    let handshake = handshake_path();
    let _ = std::fs::remove_file(&handshake);
    let antigravity_python = prepare_antigravity_sdk(app, &data_dir)?;
    let mut command = Command::new(&node);
    command.arg(&entry).current_dir(&root).env("LAW_DATA_DIR", &data_dir)
        // AppImage launcher Python variables point inside the temporary mount
        // and break the system Python used by the Antigravity SDK bridge.
        .env_remove("PYTHONHOME").env_remove("PYTHONPATH")
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if let Some(path) = antigravity_python { command.env("ASTER_ANTIGRAVITY_PYTHONPATH", path); }
    let mut child = command.spawn()
        .map_err(|error| format!("cannot start Aster local service with {}: {error}", node.display()))?;
    if let Err(error) = wait_for_handshake(&mut child, &handshake) {
        let _ = child.kill();
        return Err(error);
    }
    app.manage(LawdChild(Mutex::new(Some(child))));
    Ok(())
}
