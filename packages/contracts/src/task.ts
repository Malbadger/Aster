/**
 * Task / phase / chat contracts (BUILD-D-008..011, REQ-D-014..023,033).
 *
 * Orchestration is chat-native: plans, phases, tool calls, approvals, handoffs,
 * and results are ordinary chronological chat events (EXP-D-005; no permanent
 * orchestration ribbon). A phase locks provider/model/effort/policy/context at
 * start and they are immutable until it ends (RULE-D-003). Every typed outcome
 * (completed/blocked/error/exhausted/cancelled) is distinct.
 */
import { z } from "zod";
import { defineOperation } from "./ipc.js";
import { EffortLevel } from "./model.js";

export const PhaseStatus = z.enum([
  "pending",
  "running",
  "completed",
  "blocked",
  "error",
  "exhausted",
  "cancelled",
]);
export type PhaseStatus = z.infer<typeof PhaseStatus>;

export const TaskStatus = z.enum(["active", "completed", "blocked", "error", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** Immutable provider/model/effort identity locked at phase start. */
export const PhaseIdentity = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  effort: EffortLevel,
});
export type PhaseIdentity = z.infer<typeof PhaseIdentity>;

/** Chronological chat event kinds. `data` is always secret-scanned before store. */
export const ChatEventKind = z.enum([
  "user",
  "assistant",
  "plan",
  "tool_call",
  "tool_result",
  "tool_denied",
  "approval",
  "handoff",
  "status",
  "error",
]);
export type ChatEventKind = z.infer<typeof ChatEventKind>;

export const ChatEvent = z.object({
  id: z.string(),
  taskId: z.string(),
  phaseId: z.string().optional(),
  seq: z.number().int().nonnegative(),
  at: z.string(),
  kind: ChatEventKind,
  text: z.string().optional(),
  /** Redacted structured detail (tool input/result summary, identities). */
  data: z.record(z.string(), z.unknown()).optional(),
});
export type ChatEvent = z.infer<typeof ChatEvent>;

export const Phase = z.object({
  phaseId: z.string(),
  taskId: z.string(),
  brief: z.string(),
  identity: PhaseIdentity,
  status: PhaseStatus,
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
});
export type Phase = z.infer<typeof Phase>;

export const Task = z.object({
  taskId: z.string(),
  title: z.string(),
  status: TaskStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
  workspaceId: z.string().optional(),
  /** Default identity applied to a new phase when the message doesn't specify one. */
  defaultIdentity: PhaseIdentity.optional(),
});
export type Task = z.infer<typeof Task>;

/** How the composer text was interpreted (shown in chat before consequential work). */
export const Interpretation = z.object({
  type: z.enum(["natural-language", "slash-command", "unknown-command"]),
  command: z.string().optional(),
  summary: z.string(),
});
export type Interpretation = z.infer<typeof Interpretation>;

export const CancellationResult = z.enum(["confirmed", "uncertain"]);
export type CancellationResult = z.infer<typeof CancellationResult>;

// ---- Operations ----

export const task_create = defineOperation({
  name: "task_create",
  schemaVersion: 1,
  summary: "Create a task (chat) without requiring workflow setup.",
  consequential: false,
  request: z.object({
    title: z.string().default("New chat"),
    workspaceId: z.string().optional(),
    defaultIdentity: PhaseIdentity.optional(),
  }),
  response: z.object({ task: Task }),
});

export const task_list = defineOperation({
  name: "task_list",
  schemaVersion: 1,
  summary: "List durable tasks (task history), separate from the file tree.",
  consequential: false,
  request: z.object({ query: z.string().default("") }),
  response: z.object({ tasks: z.array(Task) }),
});

export const task_get = defineOperation({
  name: "task_get",
  schemaVersion: 1,
  summary: "Get a task with its phases.",
  consequential: false,
  request: z.object({ taskId: z.string().min(1) }),
  response: z.object({ task: Task, phases: z.array(Phase) }),
});

export const task_send_message = defineOperation({
  name: "task_send_message",
  schemaVersion: 1,
  summary: "Submit a chat message or slash command; runs one bounded turn.",
  consequential: true,
  request: z.object({
    taskId: z.string().min(1),
    text: z.string().min(1),
    identity: PhaseIdentity.optional(),
  }),
  response: z.object({
    accepted: z.boolean(),
    interpretation: Interpretation,
    phaseId: z.string().optional(),
    status: PhaseStatus,
    /** Refusal/blocked reason when accepted is false. */
    reason: z.string().optional(),
    nextSeq: z.number().int().nonnegative(),
  }),
});

export const task_get_events = defineOperation({
  name: "task_get_events",
  schemaVersion: 1,
  summary: "Fetch chronological chat events since a sequence cursor.",
  consequential: false,
  request: z.object({ taskId: z.string().min(1), sinceSeq: z.number().int().nonnegative().default(0) }),
  response: z.object({
    events: z.array(ChatEvent),
    nextSeq: z.number().int().nonnegative(),
    taskStatus: TaskStatus,
  }),
});

export const task_cancel = defineOperation({
  name: "task_cancel",
  schemaVersion: 1,
  summary: "Cancel running/queued work; reports whether cancellation was confirmed.",
  consequential: true,
  request: z.object({ taskId: z.string().min(1) }),
  response: z.object({ taskStatus: TaskStatus, cancellation: CancellationResult }),
});

export const task_delete = defineOperation({
  name: "task_delete",
  schemaVersion: 1,
  summary: "Permanently delete one inactive local chat and its stored events.",
  consequential: true,
  request: z.object({ taskId: z.string().min(1) }),
  response: z.object({ deleted: z.boolean() }),
});
