/**
 * Daemon IPC server.
 *
 * `Dispatcher` is the pure, transport-free core: it authenticates the bearer
 * token, validates the request envelope AND the per-operation request payload,
 * invokes the registered handler, and validates the handler's result against
 * the operation's response schema before returning. Any failure becomes a typed
 * error envelope — never an unvalidated passthrough. `LawdSocketServer` wires
 * `Dispatcher` to a Unix-domain socket with newline-delimited JSON frames.
 */
import { createServer, type Server, type Socket } from "node:net";
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { ContractRegistry, OperationContract, ResponseEnvelope } from "@law/contracts";
import { RequestEnvelope, PROTOCOL_VERSION } from "@law/contracts";

export interface HandlerContext {
  op: OperationContract;
}

export type Handler = (payload: unknown, ctx: HandlerContext) => Promise<unknown> | unknown;

/** A transport frame: bearer token plus the contract request envelope. */
export interface RequestFrame {
  token: string;
  request: unknown;
}

function errorEnvelope(
  id: string,
  op: string,
  schemaVersion: number,
  code: string,
  message: string,
  recovery?: string,
): ResponseEnvelope {
  return {
    protocol: PROTOCOL_VERSION,
    id,
    op,
    schemaVersion,
    ok: false,
    error: { code, message, ...(recovery ? { recovery } : {}) },
  };
}

export class Dispatcher {
  private readonly handlers = new Map<string, Handler>();

  constructor(
    private readonly registry: ContractRegistry,
    private readonly token: string,
  ) {}

  handle(opName: string, handler: Handler): this {
    if (!this.registry.get(opName)) {
      throw new Error(`cannot register handler for unknown operation: ${opName}`);
    }
    if (this.handlers.has(opName)) {
      throw new Error(`duplicate handler for operation: ${opName}`);
    }
    this.handlers.set(opName, handler);
    return this;
  }

  /** Operations that have a contract but no handler yet. */
  missingHandlers(): string[] {
    return this.registry
      .list()
      .map((o) => o.name)
      .filter((n) => !this.handlers.has(n));
  }

  async dispatch(frame: RequestFrame): Promise<ResponseEnvelope> {
    // 1. Authenticate the transport before anything else.
    if (typeof frame?.token !== "string" || frame.token !== this.token) {
      return errorEnvelope("unknown", "unknown", 1, "UNAUTHENTICATED", "invalid or missing IPC token");
    }

    // 2. Validate the request envelope shape.
    const parsed = RequestEnvelope.safeParse(frame.request);
    if (!parsed.success) {
      return errorEnvelope("unknown", "unknown", 1, "BAD_REQUEST", "malformed request envelope");
    }
    const env = parsed.data;

    // 3. Resolve the operation contract and its handler.
    const op = this.registry.get(env.op);
    if (!op) {
      return errorEnvelope(env.id, env.op, env.schemaVersion, "UNKNOWN_OPERATION", `no such operation: ${env.op}`);
    }
    if (env.schemaVersion !== op.schemaVersion) {
      return errorEnvelope(
        env.id,
        env.op,
        op.schemaVersion,
        "SCHEMA_MISMATCH",
        `client schemaVersion ${env.schemaVersion} != daemon ${op.schemaVersion}`,
        "update the client to a matching version",
      );
    }
    const handler = this.handlers.get(env.op);
    if (!handler) {
      return errorEnvelope(env.id, env.op, op.schemaVersion, "UNAVAILABLE", `operation not yet implemented: ${env.op}`);
    }

    // 4. Validate the per-operation request payload.
    const reqCheck = op.request.safeParse(env.payload);
    if (!reqCheck.success) {
      return errorEnvelope(env.id, env.op, op.schemaVersion, "BAD_REQUEST", `invalid payload for ${env.op}`);
    }

    // 5. Invoke the handler and validate its result against the response schema.
    try {
      const result = await handler(reqCheck.data, { op });
      const resCheck = op.response.safeParse(result);
      if (!resCheck.success) {
        return errorEnvelope(env.id, env.op, op.schemaVersion, "INTERNAL", `handler produced an invalid result for ${env.op}`);
      }
      return {
        protocol: PROTOCOL_VERSION,
        id: env.id,
        op: env.op,
        schemaVersion: op.schemaVersion,
        ok: true,
        result: resCheck.data,
      };
    } catch (err) {
      // Typed daemon errors may carry a stable code; everything else is INTERNAL.
      const code = (err as { code?: string })?.code ?? "INTERNAL";
      const message = err instanceof Error ? err.message : "handler error";
      return errorEnvelope(env.id, env.op, op.schemaVersion, code, message);
    }
  }
}

/** Newline-delimited JSON framing over a Unix-domain socket. */
export class LawdSocketServer {
  private server: Server | undefined;

  constructor(
    private readonly dispatcher: Dispatcher,
    private readonly socketPath: string,
  ) {}

  async listen(): Promise<void> {
    const socketDir = dirname(this.socketPath);
    const created = !existsSync(socketDir);
    mkdirSync(socketDir, { recursive: true, mode: 0o700 });
    // Only tighten a directory LAW owns; tests and embedders may use /tmp itself.
    if (created || basename(socketDir) === "law") chmodSync(socketDir, 0o700);
    rmSync(this.socketPath, { force: true });
    await new Promise<void>((resolve, reject) => {
      const server = createServer((socket) => this.onConnection(socket));
      server.once("error", reject);
      server.listen(this.socketPath, () => {
        server.removeListener("error", reject);
        this.server = server;
        chmodSync(this.socketPath, 0o600);
        resolve();
      });
    });
  }

  private onConnection(socket: Socket): void {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.trim().length === 0) continue;
        void this.onLine(line, socket);
      }
    });
    socket.on("error", () => socket.destroy());
  }

  private async onLine(line: string, socket: Socket): Promise<void> {
    let frame: RequestFrame;
    try {
      frame = JSON.parse(line) as RequestFrame;
    } catch {
      socket.write(`${JSON.stringify({ response: errorEnvelope("unknown", "unknown", 1, "BAD_REQUEST", "invalid JSON frame") })}\n`);
      return;
    }
    const response = await this.dispatcher.dispatch(frame);
    socket.write(`${JSON.stringify({ response })}\n`);
  }

  async close(): Promise<void> {
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(this.socketPath, { force: true });
    this.server = undefined;
  }
}
