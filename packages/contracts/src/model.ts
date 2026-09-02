/**
 * Provider-neutral model catalog + effort contracts (BUILD-D-005).
 *
 * Every usable model is one flat entry. The display name is primary; provider,
 * locality, auth, and status are secondary metadata (DEC-D-005, REQ-D-006). No
 * model name is hard-coded into logic — ordering and effort resolve through
 * these neutral descriptors (RULE-D-001, RULE-D-002). There is no vendor global
 * ban here; restrictions are user/admin policy (DEC-D-016).
 */
import { z } from "zod";
import { defineOperation } from "./ipc.js";

/** Provider-neutral, ordered-by-cost reasoning-effort levels. */
export const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "max"] as const;
export const EffortLevel = z.enum(EFFORT_LEVELS);
export type EffortLevel = z.infer<typeof EffortLevel>;

export const Locality = z.enum(["local", "remote", "unknown"]);
export type Locality = z.infer<typeof Locality>;

export const Availability = z.enum(["available", "unavailable", "auth-needed", "unknown"]);
export type Availability = z.infer<typeof Availability>;

export const ModelDescriptor = z.object({
  /** Stable id, provider-qualified, e.g. `ollama:llama3.1:8b`. Never shown as primary. */
  id: z.string().min(1),
  /** Primary label shown in the flat selector. */
  displayName: z.string().min(1),
  /** Free-form provider string (neutral; not a closed vendor enum). */
  provider: z.string().min(1),
  locality: Locality,
  availability: Availability,
  /** Effort levels this model's adapter supports; unsupported levels are disabled, never ignored. */
  effort: z.object({ supported: z.array(EffortLevel) }),
  /** Coarse capability flags for filtering/among secondary metadata. */
  capabilities: z.object({
    tools: z.boolean().default(false),
    vision: z.boolean().default(false),
  }),
  /** Disambiguating secondary label when display names collide (RULE-D-001). */
  secondaryLabel: z.string().optional(),
  /** Secret-free note (e.g. "needs login", "endpoint offline"). */
  note: z.string().optional(),
});
export type ModelDescriptor = z.infer<typeof ModelDescriptor>;

export const ModelCatalog = z.object({
  models: z.array(ModelDescriptor),
  favorites: z.array(z.string()),
  recent: z.array(z.string()),
  /** Exact model id selected as the deterministic default for each provider. */
  defaults: z.record(z.string(), z.string()),
});
export type ModelCatalog = z.infer<typeof ModelCatalog>;

/** List the flat model catalog (already ordered by RULE-D-001) with optional search. */
export const model_list_catalog = defineOperation({
  name: "model_list_catalog",
  schemaVersion: 1,
  summary: "Return the flat, ordered, provider-neutral model catalog.",
  consequential: false,
  request: z.object({ query: z.string().default("") }),
  response: ModelCatalog,
});

/** Toggle a favorite. Local preference only; does not change run identity (REQ-D-008). */
export const model_set_favorite = defineOperation({
  name: "model_set_favorite",
  schemaVersion: 1,
  summary: "Add or remove a model from local favorites.",
  consequential: false,
  request: z.object({ modelId: z.string().min(1), favorite: z.boolean() }),
  response: z.object({ favorites: z.array(z.string()) }),
});

export const model_set_provider_default = defineOperation({
  name: "model_set_provider_default",
  schemaVersion: 1,
  summary: "Set or clear the exact default model for a provider.",
  consequential: false,
  request: z.object({ provider: z.string().min(1), modelId: z.string().min(1).optional() }),
  response: z.object({ defaults: z.record(z.string(), z.string()) }),
});

export const ModelTargetResolution = z.object({
  model: ModelDescriptor,
  source: z.enum(["explicit", "provider-default"]),
});
export type ModelTargetResolution = z.infer<typeof ModelTargetResolution>;

export const model_resolve_target = defineOperation({
  name: "model_resolve_target",
  schemaVersion: 1,
  summary: "Resolve an explicit model or a provider default without substitution.",
  consequential: false,
  request: z.object({ provider: z.string().min(1).optional(), modelId: z.string().min(1).optional() }),
  response: ModelTargetResolution,
});

export const EffortResolution = z.object({
  modelId: z.string(),
  requested: EffortLevel,
  /** The mapped effective level, present only when supported. */
  effective: EffortLevel.optional(),
  supported: z.boolean(),
  /** Present when unsupported: why, and that it is refused (never silently ignored). */
  reason: z.string().optional(),
});
export type EffortResolution = z.infer<typeof EffortResolution>;

/** Resolve a requested effort against a model's adapter capabilities (RULE-D-002). */
export const model_resolve_effort = defineOperation({
  name: "model_resolve_effort",
  schemaVersion: 1,
  summary: "Resolve a requested effort level through the selected model's adapter.",
  consequential: false,
  request: z.object({ modelId: z.string().min(1), effort: EffortLevel }),
  response: EffortResolution,
});
