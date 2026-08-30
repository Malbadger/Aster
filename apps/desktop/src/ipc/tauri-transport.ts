/**
 * Tauri transport: forwards IPC envelopes to the Rust shell command `law_ipc`,
 * which relays them to lawd over the authenticated local channel. The UI holds
 * no provider, file, or credential access of its own.
 */
import { invoke } from "@tauri-apps/api/core";
import type { IpcTransport } from "./client.js";

export const tauriTransport: IpcTransport = {
  async send(request: unknown): Promise<unknown> {
    return invoke("law_ipc", { request });
  },
};
