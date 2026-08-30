/**
 * Provider connection, credential-reference, and offline/network contracts
 * (BUILD-D-006/007, REQ-D-009..013).
 *
 * ZERO secret values ever appear in these types. A connection carries only an
 * auth METHOD and a non-secret REFERENCE HINT (an env-var name, a command's
 * basename, a broker label) plus a resolved availability STATUS. Credential
 * values are resolved transiently by the daemon at call time and never enter
 * LAW state, UI, logs, evidence, or these contracts (DEC-D-013, REQ-D-013).
 *
 * There is no vendor global ban here (DEC-D-016): provider/model restrictions
 * are user/admin policy, applied elsewhere, never a hard-coded denial.
 */
import { z } from "zod";
import { defineOperation } from "./ipc.js";

/** How a connection authenticates. `none-local` = credential-free local inference. */
export const AuthMethod = z.enum([
  "oauth-device",
  "external-command",
  "env-var",
  "enterprise-broker",
  "none-local",
]);
export type AuthMethod = z.infer<typeof AuthMethod>;

/** Availability/status of a connection's credential — never a value. */
export const CredentialStatus = z.enum(["available", "absent", "unknown", "error"]);
export type CredentialStatus = z.infer<typeof CredentialStatus>;

export const ConnLocality = z.enum(["local", "remote"]);
export type ConnLocality = z.infer<typeof ConnLocality>;

export const ProviderConnection = z.object({
  connectionId: z.string().min(1),
  provider: z.string().min(1),
  label: z.string().min(1),
  authMethod: AuthMethod,
  locality: ConnLocality,
  enabled: z.boolean(),
  status: CredentialStatus,
  /** Non-secret hint only: env var NAME, command basename, or broker label. Never a value. */
  referenceHint: z.string().optional(),
  /** ISO-8601 of the last availability check. */
  checkedAt: z.string().optional(),
});
export type ProviderConnection = z.infer<typeof ProviderConnection>;

/** Input to create a connection. `reference` is validated to be non-secret. */
export const AddConnectionInput = z.object({
  provider: z.string().min(1),
  label: z.string().min(1),
  authMethod: AuthMethod,
  locality: ConnLocality,
  /**
   * A non-secret reference: env-var NAME (env-var), command line (external-command),
   * or broker label (enterprise-broker). Omitted for oauth-device / none-local. The
   * daemon rejects anything matching a secret pattern (REQ-D-013).
   */
  reference: z.string().optional(),
});
export type AddConnectionInput = z.infer<typeof AddConnectionInput>;

export const provider_list_connections = defineOperation({
  name: "provider_list_connections",
  schemaVersion: 1,
  summary: "List provider connections (status only, no secret values).",
  consequential: false,
  request: z.object({}).strict(),
  response: z.object({ connections: z.array(ProviderConnection) }),
});

export const provider_add_connection = defineOperation({
  name: "provider_add_connection",
  schemaVersion: 1,
  summary: "Add a provider connection from a non-secret reference.",
  consequential: true,
  request: AddConnectionInput,
  response: z.object({ connection: ProviderConnection }),
});

export const provider_remove_connection = defineOperation({
  name: "provider_remove_connection",
  schemaVersion: 1,
  summary: "Remove a provider connection.",
  consequential: true,
  request: z.object({ connectionId: z.string().min(1) }),
  response: z.object({ removed: z.boolean() }),
});

export const provider_set_enabled = defineOperation({
  name: "provider_set_enabled",
  schemaVersion: 1,
  summary: "Enable or disable a provider connection.",
  consequential: true,
  request: z.object({ connectionId: z.string().min(1), enabled: z.boolean() }),
  response: z.object({ connection: ProviderConnection }),
});

/** Check a connection's credential availability. Returns status only, never the value. */
export const provider_check_credential = defineOperation({
  name: "provider_check_credential",
  schemaVersion: 1,
  summary: "Resolve a connection's credential availability (status only).",
  consequential: false,
  request: z.object({ connectionId: z.string().min(1) }),
  response: z.object({ connectionId: z.string(), status: CredentialStatus, checkedAt: z.string() }),
});

// ---- Offline / network locality (RULE-D-006, REQ-D-009) ----

export const NetworkCode = z.enum([
  "LOOPBACK_OK",
  "REMOTE_OK",
  "OFFLINE_NON_LOOPBACK",
  "REMOTE_NEEDS_AUTH",
]);
export type NetworkCode = z.infer<typeof NetworkCode>;

export const NetCheck = z.object({
  target: z.string(),
  allowed: z.boolean(),
  code: NetworkCode,
  reason: z.string(),
});
export type NetCheck = z.infer<typeof NetCheck>;

/** Check whether an endpoint is permitted under the current offline/local policy. */
export const net_check_endpoint = defineOperation({
  name: "net_check_endpoint",
  schemaVersion: 1,
  summary: "Decide whether a target endpoint is allowed under the effective network policy.",
  consequential: false,
  request: z.object({ target: z.string().min(1) }),
  response: NetCheck,
});
