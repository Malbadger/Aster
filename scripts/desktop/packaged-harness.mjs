import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { chmodSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function packageManifest() {
  const path = "work/evidence/law-desktop/package-manifest.json";
  if (!existsSync(path)) throw new Error("package manifest missing; run desktop:package first");
  return JSON.parse(readFileSync(path, "utf8"));
}
export async function launchPackaged() {
  const artifact = packageManifest().artifacts.find((item) => item.path.endsWith(".AppImage"));
  if (!artifact || !existsSync(artifact.path)) throw new Error("AppImage artifact missing");
  chmodSync(artifact.path, 0o755);
  const handshake = join(process.env.XDG_RUNTIME_DIR || tmpdir(), "law/lawd.json");
  rmSync(handshake, { force: true });
  const child = spawn(artifact.path, ["--appimage-extract-and-run"], { detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WEBKIT_DISABLE_DMABUF_RENDERER: "1" } });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !existsSync(handshake) && child.exitCode === null) await delay(100);
  if (!existsSync(handshake)) { stopPackaged(child); throw new Error(`packaged LAW did not create daemon handshake: ${output.slice(-1200)}`); }
  const info = JSON.parse(readFileSync(handshake, "utf8"));
  child.lawdPid = info.pid;
  try {
    const status = readFileSync(`/proc/${info.pid}/status`, "utf8");
    child.appPid = Number(status.match(/^PPid:\s+(\d+)/m)?.[1] ?? 0);
  } catch {}
  return { child, artifact, info, output: () => output };
}
export function ipc(info, op, payload, schemaVersion = 1) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(info.socketPath); const id = `smoke-${randomUUID()}`; let buffer = "";
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`IPC timeout: ${op}`)); }, 10_000);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ token: info.token, request: { protocol: 1, id, op, schemaVersion, payload } })}\n`));
    socket.on("data", (chunk) => { buffer += chunk; const newline = buffer.indexOf("\n"); if (newline < 0) return; clearTimeout(timer); socket.end(); try { const frame = JSON.parse(buffer.slice(0, newline)); if (!frame.response?.ok) reject(new Error(`${op}: ${frame.response?.error?.message ?? "failed"}`)); else resolve(frame.response.result); } catch (error) { reject(error); } });
    socket.on("error", (error) => { clearTimeout(timer); reject(error); });
  });
}
export function stopPackaged(child) {
  if (child.lawdPid) { try { process.kill(child.lawdPid, "SIGTERM"); } catch {} }
  if (child.appPid) { try { process.kill(child.appPid, "SIGTERM"); } catch {} }
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
}
export { delay };
