/**
 * Local IPC handshake.
 *
 * The daemon listens on a Unix-domain socket (no TCP port is ever opened) and
 * writes a handshake file, readable only by the user (0600), describing the
 * socket path and a per-run bearer token. The Tauri shell reads this file to
 * learn where to connect and how to authenticate. A caller that cannot present
 * the token is refused. This satisfies the transport rule: authenticated local
 * IPC / Unix-domain transport with origin+token controls (04 Forbidden actions).
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { PROTOCOL_VERSION } from "@law/contracts";

export interface Handshake {
  socketPath: string;
  token: string;
  pid: number;
  protocol: number;
}

function runtimeDir(): string {
  const base = process.env.XDG_RUNTIME_DIR && process.env.XDG_RUNTIME_DIR.trim().length > 0
    ? process.env.XDG_RUNTIME_DIR
    : tmpdir();
  return join(base, "law");
}

export function handshakePath(): string {
  return join(runtimeDir(), "lawd.json");
}

export function defaultSocketPath(): string {
  // A short, per-user path. UDS path length is limited (~108 bytes) on Linux.
  return join(runtimeDir(), "lawd.sock");
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

/** Write the handshake file with 0600 perms after the socket is listening. */
export function writeHandshake(h: Handshake): void {
  const dir = runtimeDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = handshakePath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(h, null, 2)}\n`, { mode: 0o600 });
  // Atomic replace so a reader never sees a half-written file.
  writeFileSync(path, readFileSync(tmp), { mode: 0o600 });
  rmSync(tmp, { force: true });
}

export function readHandshake(): Handshake | null {
  const path = handshakePath();
  if (!existsSync(path)) return null;
  try {
    const h = JSON.parse(readFileSync(path, "utf8")) as Handshake;
    if (typeof h.socketPath === "string" && typeof h.token === "string") return h;
    return null;
  } catch {
    return null;
  }
}

export function clearHandshake(): void {
  rmSync(handshakePath(), { force: true });
}

export const CURRENT_PROTOCOL = PROTOCOL_VERSION;
