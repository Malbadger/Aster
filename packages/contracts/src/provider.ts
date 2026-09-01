/**
 * Provider connection, credential-reference, and offline/network contracts
 * (BUILD-D-006/007, REQ-D-009..013).
 *
 * ZERO secret values ever appear in these types. A connection carries only an
 * auth METHOD and a non-secret REFERENCE HINT (an env-var name, a command's
 * basename, a broker label) plus a resolved availability STATUS. Credential
 * values are resolved transiently by the daemon at call time and never enter
 * Aster state, UI, logs, evidence, or these contracts (DEC-D-013, REQ-D-013).
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

/** Wire protocol used by a user-defined inference endpoint. */
export const ProviderApi = z.enum([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
]);
export type ProviderApi = z.infer<typeof ProviderApi>;

export const ProviderModel = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  reasoning: z.boolean().default(false),
  vision: z.boolean().default(false),
  contextWindow: z.number().int().positive().default(128_000),
  maxTokens: z.number().int().positive().default(16_384),
});
export type ProviderModel = z.infer<typeof ProviderModel>;

/**
 * Secret-free endpoint definition. Header values are config references (an
 * environment-variable name or !command), never the resolved value.
 */
export const ProviderEndpoint = z.object({
  baseUrl: z.string().url(),
  api: ProviderApi,
  models: z.array(ProviderModel).min(1),
  authHeader: z.boolean().default(true),
  headers: z.array(z.object({ name: z.string().min(1), valueReference: z.string().min(1) })).default([]),
});
export type ProviderEndpoint = z.infer<typeof ProviderEndpoint>;

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
  /** Present for a user-defined local or enterprise model endpoint. */
  endpoint: ProviderEndpoint.optional(),
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
  endpoint: ProviderEndpoint.optional(),
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

const AuthPrompt = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), message: z.string(), placeholder: z.string().optional() }),
  z.object({ type: z.literal("secret"), message: z.string(), placeholder: z.string().optional() }),
  z.object({ type: z.literal("manual_code"), message: z.string(), placeholder: z.string().optional() }),
  z.object({ type: z.literal("select"), message: z.string(), options: z.array(z.object({ id: z.string(), label: z.string(), description: z.string().optional() })) }),
]);
export const AuthFlow = z.object({
  flowId: z.string(), provider: z.string(), authType: z.enum(["oauth", "api_key"]),
  status: z.enum(["running", "waiting", "completed", "error", "cancelled"]),
  messages: z.array(z.object({ type: z.enum(["info", "auth_url", "device_code", "progress"]), message: z.string().optional(), url: z.string().optional(), userCode: z.string().optional(), verificationUri: z.string().optional() })),
  prompt: AuthPrompt.optional(), error: z.string().optional(),
});
export type AuthFlow = z.infer<typeof AuthFlow>;

export const provider_auth_methods = defineOperation({
  name: "provider_auth_methods", schemaVersion: 1, summary: "List Pi-owned provider login methods.", consequential: false,
  request: z.object({}).strict(), response: z.object({ providers: z.array(z.object({ id: z.string(), name: z.string(), methods: z.array(z.enum(["oauth", "api_key"])), configured: z.boolean() })) }),
});
export const provider_auth_start = defineOperation({
  name: "provider_auth_start", schemaVersion: 1, summary: "Start an interactive Pi-owned login flow.", consequential: true,
  request: z.object({ provider: z.string(), authType: z.enum(["oauth", "api_key"]) }), response: z.object({ flow: AuthFlow }),
});
export const provider_auth_get = defineOperation({
  name: "provider_auth_get", schemaVersion: 1, summary: "Read a Pi login flow without credential values.", consequential: false,
  request: z.object({ flowId: z.string() }), response: z.object({ flow: AuthFlow }),
});
export const provider_auth_respond = defineOperation({
  name: "provider_auth_respond", schemaVersion: 1, summary: "Answer the current Pi login prompt transiently.", consequential: true,
  request: z.object({ flowId: z.string(), response: z.string() }), response: z.object({ accepted: z.boolean() }),
});
export const provider_auth_cancel = defineOperation({
  name: "provider_auth_cancel", schemaVersion: 1, summary: "Cancel a Pi login flow.", consequential: true,
  request: z.object({ flowId: z.string() }), response: z.object({ cancelled: z.boolean() }),
});
export const provider_auth_logout = defineOperation({
  name: "provider_auth_logout", schemaVersion: 1, summary: "Remove Pi-owned credentials for a provider.", consequential: true,
  request: z.object({ provider: z.string() }), response: z.object({ loggedOut: z.boolean() }),
});

export const provider_gemini_cli_status = defineOperation({
  name: "provider_gemini_cli_status",
  schemaVersion: 1,
  summary: "Report supported Google coding CLIs and available models without reading credentials.",
  consequential: false,
  request: z.object({}).strict(),
  response: z.object({
    installed: z.boolean(),
    configured: z.boolean(),
    version: z.string().optional(),
    authType: z.string().optional(),
    antigravityInstalled: z.boolean().optional(),
    antigravityConfigured: z.boolean().optional(),
    antigravityVersion: z.string().optional(),
    migrationRequired: z.boolean().optional(),
    models: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
  }),
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
