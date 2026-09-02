import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { callAsterDaemon } from "../../src/mcp/daemon-client.js";

const roots: string[] = [];
const originalRuntime = process.env.XDG_RUNTIME_DIR;

afterEach(() => {
  if (originalRuntime === undefined) delete process.env.XDG_RUNTIME_DIR; else process.env.XDG_RUNTIME_DIR = originalRuntime;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Aster MCP daemon client", () => {
  it("authenticates through the local handshake and returns a validated operation result", async () => {
    const root = mkdtempSync(join(tmpdir(), "aster-mcp-test-")); roots.push(root);
    const runtime = join(root, "law"); mkdirSync(runtime, { recursive: true });
    const socketPath = join(runtime, "lawd.sock");
    const server = createServer((socket) => {
      socket.setEncoding("utf8");
      socket.once("data", (line: string) => {
        const frame = JSON.parse(line) as { token: string; request: { op: string } };
        expect(frame.token).toBe("private-token"); expect(frame.request.op).toBe("model_list_catalog");
        socket.end(`${JSON.stringify({ response: { ok: true, result: { models: ["one"] } } })}\n`);
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    process.env.XDG_RUNTIME_DIR = root;
    writeFileSync(join(runtime, "lawd.json"), JSON.stringify({ socketPath, token: "private-token", protocol: 1 }), { mode: 0o600 });
    await expect(callAsterDaemon<{ models: string[] }>("model_list_catalog", { query: "" })).resolves.toEqual({ models: ["one"] });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("explains that the desktop app must be running when no handshake exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "aster-mcp-missing-")); roots.push(root); process.env.XDG_RUNTIME_DIR = root;
    await expect(callAsterDaemon("model_list_catalog", {})).rejects.toThrow(/Aster is not running/);
  });
});
