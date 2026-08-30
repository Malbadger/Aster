// Prevent an extra console window on Windows in release (harmless on Linux).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMA-BUF renderer can produce a blank window when the active
    // Linux graphics stack cannot allocate GBM buffers (for example, some
    // Nouveau, VM, and restricted-session configurations). Keep an explicit
    // operator-provided value, otherwise use the compatible renderer.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    law_desktop_lib::run()
}
