/**
 * Typed IPC client (UI side).
 *
 * Wraps every daemon call in the shared contract: it validates the request
 * against the operation's request schema before sending and validates the
 * response against the response schema on return. A schema mismatch fails
 * closed. The transport is injectable so tests and the Tauri bridge share one
 * code path and the UI never reaches a provider/tool/file directly.
 */
import type { OperationContract } from "@law/contracts";
import { PROTOCOL_VERSION, ResponseEnvelope } from "@law/contracts";
import type { z } from "zod";

export interface IpcTransport {
  /** Send one request envelope and resolve the raw response envelope. */
  send(request: unknown): Promise<unknown>;
}

export class IpcClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly recovery?: string,
    readonly reference?: string,
  ) {
    super(message);
    this.name = "IpcClientError";
  }
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `ui-${Date.now()}-${counter}`;
}

export function createIpcClient(transport: IpcTransport) {
  async function call<TReq extends z.ZodTypeAny, TRes extends z.ZodTypeAny>(
    op: OperationContract<TReq, TRes>,
    payload: z.infer<TReq>,
  ): Promise<z.infer<TRes>> {
    const reqPayload = op.request.parse(payload);
    const envelope = {
      protocol: PROTOCOL_VERSION,
      id: nextId(),
      op: op.name,
      schemaVersion: op.schemaVersion,
      payload: reqPayload,
    };

    const raw = await transport.send(envelope);
    const parsed = ResponseEnvelope.safeParse(raw);
    if (!parsed.success) {
      throw new IpcClientError(
        "daemon response failed envelope validation",
        "SCHEMA_MISMATCH",
      );
    }
    const res = parsed.data;
    if (!res.ok) {
      const err = res.error;
      throw new IpcClientError(
        err?.message ?? "operation failed",
        err?.code ?? "INTERNAL",
        err?.recovery,
        err?.reference,
      );
    }
    const result = op.response.safeParse(res.result);
    if (!result.success) {
      throw new IpcClientError(
        `result failed schema for ${op.name}`,
        "SCHEMA_MISMATCH",
      );
    }
    return result.data;
  }

  return { call };
}

export type IpcClient = ReturnType<typeof createIpcClient>;
