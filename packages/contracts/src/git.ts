/**
 * Git contracts (BUILD-D-016, REQ-D-034..036). Local branch/worktree/stage/
 * commit/patch are supported directly. Any REMOTE mutation (push, force,
 * remote-branch delete, PR) requires an explicit confirmation scoped to the
 * exact repository, remote, branch, and effect (RULE-D-007); no prompt text
 * alone authorizes a remote effect. Git runs via argument arrays (no shell).
 */
import { z } from "zod";
import { defineOperation } from "./ipc.js";

export const GitFileEntry = z.object({ path: z.string(), state: z.enum(["staged", "unstaged", "untracked", "conflicted"]) });
export type GitFileEntry = z.infer<typeof GitFileEntry>;

export const GitStatus = z.object({
  branch: z.string(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  clean: z.boolean(),
  files: z.array(GitFileEntry),
});
export type GitStatus = z.infer<typeof GitStatus>;

export const git_status = defineOperation({
  name: "git_status",
  schemaVersion: 1,
  summary: "Report repository status (branch, ahead/behind, changed files).",
  consequential: false,
  request: z.object({}).strict(),
  response: z.object({ status: GitStatus }),
});

export const git_stage = defineOperation({
  name: "git_stage",
  schemaVersion: 1,
  summary: "Stage paths (local only).",
  consequential: true,
  request: z.object({ paths: z.array(z.string().min(1)).min(1) }),
  response: z.object({ status: GitStatus }),
});

export const git_commit = defineOperation({
  name: "git_commit",
  schemaVersion: 1,
  summary: "Create a local commit from staged changes.",
  consequential: true,
  request: z.object({ message: z.string().min(1) }),
  response: z.object({ commit: z.string(), status: GitStatus }),
});

export const git_create_branch = defineOperation({
  name: "git_create_branch",
  schemaVersion: 1,
  summary: "Create and switch to a local branch.",
  consequential: true,
  request: z.object({ name: z.string().min(1) }),
  response: z.object({ status: GitStatus }),
});

export const RemoteEffect = z.enum(["push", "force-push", "delete-remote-branch", "open-pr"]);
export type RemoteEffect = z.infer<typeof RemoteEffect>;

/** Explicit scoped confirmation; must match the requested effect exactly (RULE-D-007). */
export const RemoteConfirmation = z.object({
  repository: z.string().min(1),
  remote: z.string().min(1),
  branch: z.string().min(1),
  effect: RemoteEffect,
});
export type RemoteConfirmation = z.infer<typeof RemoteConfirmation>;

export const git_remote_action = defineOperation({
  name: "git_remote_action",
  schemaVersion: 1,
  summary: "Perform a remote Git effect ONLY with matching scoped confirmation.",
  consequential: true,
  request: z.object({
    effect: RemoteEffect,
    remote: z.string().min(1),
    branch: z.string().min(1),
    confirmation: RemoteConfirmation.optional(),
  }),
  response: z.object({
    performed: z.boolean(),
    /** Present when refused: the exact scope the user must confirm. */
    requiredConfirmation: RemoteConfirmation.optional(),
    reason: z.string().optional(),
  }),
});
