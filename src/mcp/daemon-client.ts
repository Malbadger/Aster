import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Handshake { socketPath: string; token: string; protocol: number }
interface ResponseFrame { response?: { ok?: boolean; result?: unknown; error?: { message?: string; recovery?: string } } }

function handshakePath(): string {
  const base = process.env.XDG_RUNTIME_DIR?.trim() || tmpdir();
  return join(base, "law", "lawd.json");
}

function readHandshake(): Handshake {
  try {
    const value = JSON.parse(readFileSync(handshakePath(), "utf8")) as Handshake;
    if (!value.socketPath || !value.token || !value.protocol) throw new Error("invalid handshake");
    return value;
  } catch {
    throw new Error("Aster is not running. Open the Aster desktop application and try again.");
  }
}

export async function callAsterDaemon<T>(op: string, payload: unknown, timeoutMs = 15_000): Promise<T> {
  const handshake = readHandshake();
  const request = {
    protocol: handshake.protocol,
    id: `mcp-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
    op,
    schemaVersion: 1,
    payload,
  };
  const frame = await new Promise<ResponseFrame>((resolve, reject) => {
    const socket = createConnection(handshake.socketPath);
    let buffer = "";
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`Aster IPC timed out during ${op}.`)); }, timeoutMs);
    const finish = (fn: () => void) => { clearTimeout(timer); socket.destroy(); fn(); };
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ token: handshake.token, request })}\n`));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try { const parsed = JSON.parse(buffer.slice(0, newline)) as ResponseFrame; finish(() => resolve(parsed)); }
      catch { finish(() => reject(new Error("Aster returned invalid IPC data."))); }
    });
    socket.on("error", (error) => finish(() => reject(error)));
  });
  if (!frame.response?.ok) {
    const error = frame.response?.error;
    throw new Error([error?.message ?? `Aster operation ${op} failed.`, error?.recovery].filter(Boolean).join(" "));
  }
  return frame.response.result as T;
}

