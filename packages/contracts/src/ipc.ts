/**
 * Aster desktop IPC contract core.
 *
 * One typed source of truth for every UI <-> daemon operation. Each operation
 * binds a Zod request schema and a Zod response schema to a versioned,
 * `domain_action_resource`-named channel. Both the daemon (server) and the UI
 * (client) validate request AND response against these schemas at runtime, so a
 * contract drift fails closed instead of silently corrupting state.
 *
 * The UI never calls providers/tools/shell/Git/files/policy/evidence/credentials
 * directly; every such effect is an operation defined here and executed by the
 * daemon behind deterministic gates (Functional Contract, Architecture contract).
 */
import { z } from "zod";

/** Current envelope protocol version. Bump only on a breaking envelope change. */
export const PROTOCOL_VERSION = 1 as const;

/**
 * Operation name: `domain_action_resource`, lower_snake_case, 2-4 segments.
 * Examples: `daemon_get_health`, `model_list_catalog`, `git_commit_changes`.
 */
export const OperationName = z
  .string()
  .regex(
    /^[a-z][a-z0-9]*(_[a-z0-9]+){1,3}$/,
    "operation must be domain_action_resource lower_snake_case with 2-4 segments",
  );
export type OperationName = z.infer<typeof OperationName>;

/** A single versioned operation binding request and response schemas. */
export interface OperationContract<
  TReq extends z.ZodTypeAny = z.ZodTypeAny,
  TRes extends z.ZodTypeAny = z.ZodTypeAny,
> {
  readonly name: string;
  /** Schema version for THIS operation, independent of PROTOCOL_VERSION. */
  readonly schemaVersion: number;
  readonly request: TReq;
  readonly response: TRes;
  /** Human-readable summary used in generated docs and diagnostics. */
  readonly summary: string;
  /** True when the operation can change machine/repo/remote state. */
  readonly consequential: boolean;
}

export function defineOperation<TReq extends z.ZodTypeAny, TRes extends z.ZodTypeAny>(
  spec: OperationContract<TReq, TRes>,
): OperationContract<TReq, TRes> {
  OperationName.parse(spec.name);
  if (!Number.isInteger(spec.schemaVersion) || spec.schemaVersion < 1) {
    throw new Error(`operation ${spec.name}: schemaVersion must be a positive integer`);
  }
  return spec;
}

/** Request envelope sent UI -> daemon. */
export const RequestEnvelope = z.object({
  protocol: z.literal(PROTOCOL_VERSION),
  /** Correlates response to request; also used for cancellation. */
  id: z.string().min(1),
  op: OperationName,
  schemaVersion: z.number().int().positive(),
  /** Operation-specific payload, validated per-operation against its request schema. */
  payload: z.unknown(),
});
export type RequestEnvelope = z.infer<typeof RequestEnvelope>;

/** Typed, provider-neutral error surfaced to the UI. Never carries secrets. */
export const IpcError = z.object({
  /** Stable machine code, e.g. `POLICY_DENIED`, `OFFLINE`, `UNAUTHENTICATED`. */
  code: z.string().min(1),
  /** Human-readable, secret-free message. */
  message: z.string(),
  /** Optional recovery hint the UI can present as an action. */
  recovery: z.string().optional(),
  /** Optional OPEN-D / CHG-D / policy reference for blocked states. */
  reference: z.string().optional(),
});
export type IpcError = z.infer<typeof IpcError>;

/** Response envelope sent daemon -> UI. Exactly one of result/error is present. */
export const ResponseEnvelope = z.object({
  protocol: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1),
  op: OperationName,
  schemaVersion: z.number().int().positive(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: IpcError.optional(),
});
export type ResponseEnvelope = z.infer<typeof ResponseEnvelope>;

/** Canonical typed error codes shared by daemon and UI. */
export const ERROR_CODES = [
  "BAD_REQUEST",
  "UNKNOWN_OPERATION",
  "SCHEMA_MISMATCH",
  "UNAUTHENTICATED",
  "UNAUTHORIZED",
  "POLICY_DENIED",
  "OFFLINE",
  "UNAVAILABLE",
  "EXHAUSTED",
  "CANCELLED",
  "CONFLICT",
  "STALE",
  "NOT_FOUND",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** A registry of operations, guarding against duplicate names. */
export class ContractRegistry {
  private readonly ops = new Map<string, OperationContract>();

  register<TReq extends z.ZodTypeAny, TRes extends z.ZodTypeAny>(
    op: OperationContract<TReq, TRes>,
  ): OperationContract<TReq, TRes> {
    if (this.ops.has(op.name)) {
      throw new Error(`duplicate operation contract: ${op.name}`);
    }
    this.ops.set(op.name, op);
    return op;
  }

  get(name: string): OperationContract | undefined {
    return this.ops.get(name);
  }

  list(): OperationContract[] {
    return [...this.ops.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
