/**
 * Minimal newline-delimited JSON client over a Unix-domain socket. Used by
 * tests and by any Node-side caller; the Tauri Rust shell implements the same
 * framing. One request per connection keeps framing trivial and robust.
 */
import { createConnection } from "node:net";
import type { ResponseEnvelope } from "@law/contracts";

export function callOverSocket(
  socketPath: string,
  token: string,
  request: unknown,
  timeoutMs = 5000,
): Promise<ResponseEnvelope> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    const done = (fn: () => void) => {
      socket.destroy();
      fn();
    };
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ token, request })}\n`);
    });
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const idx = buffer.indexOf("\n");
      if (idx >= 0) {
        try {
          const parsed = JSON.parse(buffer.slice(0, idx)) as { response: ResponseEnvelope };
          done(() => resolve(parsed.response));
        } catch (err) {
          done(() => reject(err));
        }
      }
    });
    socket.on("timeout", () => done(() => reject(new Error("IPC timeout"))));
    socket.on("error", (err) => done(() => reject(err)));
  });
}
