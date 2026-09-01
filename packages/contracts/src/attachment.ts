import { z } from "zod";
import { defineOperation } from "./ipc.js";

export const AttachmentKind = z.enum(["text", "image", "pdf"]);
export type AttachmentKind = z.infer<typeof AttachmentKind>;

export const AttachmentDescriptor = z.object({
  attachmentId: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number().int().nonnegative(),
  kind: AttachmentKind,
});
export type AttachmentDescriptor = z.infer<typeof AttachmentDescriptor>;

export const attachment_import = defineOperation({
  name: "attachment_import",
  schemaVersion: 1,
  summary: "Copy a user-selected local file into Aster's private attachment staging area.",
  consequential: true,
  request: z.object({ path: z.string().min(1) }),
  response: z.object({ attachment: AttachmentDescriptor }),
});

export const attachment_stage = defineOperation({
  name: "attachment_stage",
  schemaVersion: 1,
  summary: "Stage a dropped or pasted file in Aster's private attachment area.",
  consequential: true,
  request: z.object({ name: z.string().min(1), mimeType: z.string().default("application/octet-stream"), dataBase64: z.string().min(1) }),
  response: z.object({ attachment: AttachmentDescriptor }),
});
