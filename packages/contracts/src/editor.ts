/**
 * Editor / file / diff / verification contracts (BUILD-D-012/013/014,
 * REQ-D-026..032). The editor is optional but real: editing, editable diffs with
 * file/hunk accept-reject, provenance, verification staleness, and diagnostics.
 *
 * Verification is bound to an exact content hash: a PASS is valid only for that
 * hash. Any manual edit changes the hash and immediately makes prior
 * verification STALE (RULE-D-004, DEC-D-011). Provenance is evidence, not an
 * authorship-certainty claim.
 */
import { z } from "zod";
import { defineOperation } from "./ipc.js";

export const Provenance = z.enum(["model", "human", "formatter", "merge", "mixed", "none"]);
export type Provenance = z.infer<typeof Provenance>;

export const VerificationResult = z.enum(["pass", "fail", "stale", "unverified"]);
export type VerificationResult = z.infer<typeof VerificationResult>;

export const FileState = z.object({
  path: z.string(),
  /** SHA-256 of current content. */
  contentHash: z.string(),
  provenance: Provenance,
  /** Verification result bound to `contentHash` (stale if a prior pass was for another hash). */
  verification: VerificationResult,
  /** Present when verification is stale: the hash the last pass was bound to. */
  verifiedHash: z.string().optional(),
});
export type FileState = z.infer<typeof FileState>;

export const WorkspaceEntry = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(["file", "directory", "symlink"]),
});
export type WorkspaceEntry = z.infer<typeof WorkspaceEntry>;

export const fs_list_directory = defineOperation({
  name: "fs_list_directory",
  schemaVersion: 1,
  summary: "List one workspace directory for the lazy desktop Explorer.",
  consequential: false,
  request: z.object({ path: z.string().min(1) }),
  response: z.object({ path: z.string(), entries: z.array(WorkspaceEntry) }),
});

export const fs_read_file = defineOperation({
  name: "fs_read_file",
  schemaVersion: 1,
  summary: "Read a workspace file and its current state (hash, provenance, verification).",
  consequential: false,
  request: z.object({ path: z.string().min(1) }),
  response: z.object({ path: z.string(), content: z.string(), state: FileState }),
});

export const fs_write_file = defineOperation({
  name: "fs_write_file",
  schemaVersion: 1,
  summary: "Write a workspace file; records provenance and invalidates prior verification.",
  consequential: true,
  request: z.object({
    path: z.string().min(1),
    content: z.string(),
    /** Who authored this change. A human edit invalidates prior verification (RULE-D-004). */
    author: z.enum(["human", "model", "formatter"]),
  }),
  response: z.object({ state: FileState }),
});

export const VerificationRun = z.object({
  verificationId: z.string(),
  path: z.string(),
  changeHash: z.string(),
  commands: z.array(z.string()),
  result: z.enum(["pass", "fail"]),
  at: z.string(),
});
export type VerificationRun = z.infer<typeof VerificationRun>;

export const verify_run = defineOperation({
  name: "verify_run",
  schemaVersion: 1,
  summary: "Run required checks against a file's current content hash.",
  consequential: true,
  request: z.object({ path: z.string().min(1) }),
  response: z.object({ run: VerificationRun, state: FileState }),
});

export const verify_get_status = defineOperation({
  name: "verify_get_status",
  schemaVersion: 1,
  summary: "Get the verification state for a file bound to its current hash.",
  consequential: false,
  request: z.object({ path: z.string().min(1) }),
  response: z.object({ state: FileState }),
});

// ---- Diff / changeset ----

export const HunkStatus = z.enum(["pending", "accepted", "rejected"]);
export type HunkStatus = z.infer<typeof HunkStatus>;

export const Hunk = z.object({
  hunkId: z.string(),
  /** 1-based start line in the original file. */
  oldStart: z.number().int(),
  oldLines: z.number().int(),
  newStart: z.number().int(),
  newLines: z.number().int(),
  /** Unified-diff body lines (prefixed with ' ', '+', '-'). */
  lines: z.array(z.string()),
  status: HunkStatus,
  provenance: Provenance,
});
export type Hunk = z.infer<typeof Hunk>;

export const ChangeSet = z.object({
  changeSetId: z.string(),
  path: z.string(),
  baseHash: z.string(),
  hunks: z.array(Hunk),
});
export type ChangeSet = z.infer<typeof ChangeSet>;

// ---- Autocomplete (REQ-D-031/032) ----

/** Opt-in autocomplete, independently configured from chat. Disabled by default. */
export const AutocompleteConfig = z.object({
  enabled: z.boolean(),
  /** Separately selected model id (may differ from the chat model). */
  modelId: z.string().optional(),
  locality: z.enum(["local", "remote", "unknown"]),
  /** Max tokens/budget for a completion; keeps context within policy. */
  maxTokens: z.number().int().positive().default(64),
});
export type AutocompleteConfig = z.infer<typeof AutocompleteConfig>;

export const autocomplete_get_config = defineOperation({
  name: "autocomplete_get_config",
  schemaVersion: 1,
  summary: "Get autocomplete configuration (disabled by default).",
  consequential: false,
  request: z.object({}).strict(),
  response: z.object({ config: AutocompleteConfig }),
});

export const autocomplete_set_config = defineOperation({
  name: "autocomplete_set_config",
  schemaVersion: 1,
  summary: "Configure opt-in autocomplete (model, locality, budget).",
  consequential: false,
  request: AutocompleteConfig,
  response: z.object({ config: AutocompleteConfig }),
});

export const autocomplete_complete = defineOperation({
  name: "autocomplete_complete",
  schemaVersion: 1,
  summary: "Request a completion; refused when disabled; discloses locality.",
  consequential: false,
  request: z.object({ path: z.string().min(1), prefix: z.string(), suffix: z.string().default("") }),
  response: z.object({
    enabled: z.boolean(),
    suggestion: z.string().optional(),
    locality: z.enum(["local", "remote", "unknown"]),
    reason: z.string().optional(),
  }),
});
