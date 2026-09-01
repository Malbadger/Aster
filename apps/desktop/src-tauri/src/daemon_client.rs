//! Relays one IPC envelope from the UI to lawd over the authenticated
//! Unix-domain socket. The shell learns the socket path and bearer token from
//! the daemon's handshake file; it never holds provider, file, or credential
//! access of its own. Blocking socket I/O runs on a blocking task so the async
//! command does not stall the UI thread.

use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::Duration;

use serde_json::Value;

fn runtime_dir() -> PathBuf {
    let base = match env::var("XDG_RUNTIME_DIR") {
        Ok(v) if !v.trim().is_empty() => PathBuf::from(v),
        _ => env::temp_dir(),
    };
    base.join("law")
}

fn handshake_path() -> PathBuf {
    runtime_dir().join("lawd.json")
}

/// Error envelope matching the shared contract, so the UI validates it uniformly.
fn error_envelope(request: &Value, code: &str, message: &str, recovery: &str) -> Value {
    serde_json::json!({
        "protocol": 1,
        "id": request.get("id").and_then(Value::as_str).unwrap_or("unknown"),
        "op": request.get("op").and_then(Value::as_str).unwrap_or("unknown"),
        "schemaVersion": request.get("schemaVersion").and_then(Value::as_u64).unwrap_or(1),
        "ok": false,
        "error": { "code": code, "message": message, "recovery": recovery }
    })
}

/// Blocking relay: read handshake, connect, send `{token,request}\n`, read one
/// `{response}` line. Returns the daemon's response envelope, or a typed error
/// envelope when the daemon is unreachable.
pub fn relay(request: Value) -> Value {
    let handshake = match fs::read_to_string(handshake_path()) {
        Ok(s) => s,
        Err(_) => {
            return error_envelope(
                &request,
                "UNAVAILABLE",
                "Aster daemon is not running (no handshake file)",
                "start lawd and retry",
            )
        }
    };
    let hs: Value = match serde_json::from_str(&handshake) {
        Ok(v) => v,
        Err(_) => return error_envelope(&request, "INTERNAL", "invalid daemon handshake", "restart lawd"),
    };
    let socket_path = hs.get("socketPath").and_then(Value::as_str).unwrap_or_default();
    let token = hs.get("token").and_then(Value::as_str).unwrap_or_default();
    if socket_path.is_empty() || token.is_empty() {
        return error_envelope(&request, "INTERNAL", "daemon handshake missing socket or token", "restart lawd");
    }

    let stream = match UnixStream::connect(socket_path) {
        Ok(s) => s,
        Err(_) => {
            return error_envelope(
                &request,
                "UNAVAILABLE",
                "could not connect to the Aster daemon socket",
                "start lawd and retry",
            )
        }
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(30)));

    let frame = serde_json::json!({ "token": token, "request": request });
    let mut writer = stream.try_clone().expect("clone unix stream");
    if writeln!(writer, "{}", frame).is_err() {
        return error_envelope(&request, "UNAVAILABLE", "failed to send request to daemon", "retry");
    }

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
        return error_envelope(&request, "UNAVAILABLE", "no response from daemon", "retry");
    }
    match serde_json::from_str::<Value>(&line) {
        Ok(v) => v.get("response").cloned().unwrap_or_else(|| {
            error_envelope(&request, "INTERNAL", "daemon returned an unframed response", "retry")
        }),
        Err(_) => error_envelope(&request, "INTERNAL", "daemon returned invalid JSON", "retry"),
    }
}
