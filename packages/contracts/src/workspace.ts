import { z } from "zod";
import { defineOperation } from "./ipc.js";

export const workspace_get_root = defineOperation({
  name: "workspace_get_root", schemaVersion: 1,
  summary: "Return the active local workspace root.", consequential: false,
  request: z.object({}).strict(), response: z.object({ path: z.string().optional() }),
});
export const workspace_set_root = defineOperation({
  name: "workspace_set_root", schemaVersion: 1,
  summary: "Set an explicitly user-selected local workspace root.", consequential: true,
  request: z.object({ path: z.string().min(1) }), response: z.object({ path: z.string() }),
});
