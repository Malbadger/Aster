import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { AttachmentDescriptor, AttachmentKind } from "@law/contracts";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARS = 500_000;
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".mdx", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".xml", ".csv", ".tsv", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".rb", ".rs", ".go", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".swift", ".sh", ".bash", ".zsh", ".fish", ".sql", ".css", ".scss", ".html", ".vue", ".svelte", ".ini", ".conf", ".env", ".log",
]);

export interface ResolvedAttachment extends AttachmentDescriptor {
  stagedPath: string;
  text?: string;
  dataBase64?: string;
}

export class AttachmentService {
  private readonly root: string;
  private readonly index = new Map<string, { descriptor: AttachmentDescriptor; path: string }>();

  constructor(dataRoot: string) {
    this.root = join(dataRoot, ".law", "attachments");
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    chmodSync(this.root, 0o700);
  }

  importPath(path: string): { attachment: AttachmentDescriptor } {
    const source = statSync(path);
    if (!source.isFile()) throw Object.assign(new Error("Only files can be attached to chat."), { code: "INVALID_ATTACHMENT" });
    if (source.size > MAX_FILE_BYTES) throw Object.assign(new Error(`“${basename(path)}” exceeds Aster's 25 MB per-file limit.`), { code: "ATTACHMENT_LIMIT" });
    const bytes = readFileSync(path);
    return this.stage(basename(path), detectMime(path, bytes), bytes);
  }

  stageBase64(name: string, mimeType: string, dataBase64: string): { attachment: AttachmentDescriptor } {
    if (dataBase64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4) throw Object.assign(new Error(`“${name}” exceeds Aster's 25 MB per-file limit.`), { code: "ATTACHMENT_LIMIT" });
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataBase64)) throw Object.assign(new Error("The attachment is not valid base64."), { code: "INVALID_ATTACHMENT" });
    const bytes = Buffer.from(dataBase64, "base64");
    if (!bytes.length) throw Object.assign(new Error("The attachment is empty or not valid base64."), { code: "INVALID_ATTACHMENT" });
    return this.stage(name, normalizeMime(mimeType, name, bytes), bytes);
  }

  resolve(ids: string[]): ResolvedAttachment[] {
    if (ids.length > 10) throw Object.assign(new Error("Attach at most 10 files to one message."), { code: "ATTACHMENT_LIMIT" });
    return ids.map((id) => {
      const item = this.index.get(id);
      if (!item) throw Object.assign(new Error(`Attachment ${id} is no longer available. Attach it again.`), { code: "NOT_FOUND" });
      const bytes = readFileSync(item.path);
      if (item.descriptor.kind === "image") return { ...item.descriptor, stagedPath: item.path, dataBase64: bytes.toString("base64") };
      const text = item.descriptor.kind === "pdf" ? extractPdf(item.path) : decodeText(bytes, item.descriptor.name);
      const bounded = text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[Attachment truncated by Aster at ${MAX_TEXT_CHARS.toLocaleString()} characters.]` : text;
      return { ...item.descriptor, stagedPath: item.path, text: bounded };
    });
  }

  private stage(name: string, mimeType: string, bytes: Buffer): { attachment: AttachmentDescriptor } {
    if (bytes.length > MAX_FILE_BYTES) throw Object.assign(new Error(`“${name}” exceeds Aster's 25 MB per-file limit.`), { code: "ATTACHMENT_LIMIT" });
    const safeName = sanitizeName(name);
    const kind = classify(safeName, mimeType, bytes);
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const attachmentId = `att-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const path = join(this.root, `${hash}-${attachmentId.slice(-6)}-${safeName}`);
    writeFileSync(path, bytes, { mode: 0o600 });
    const descriptor: AttachmentDescriptor = { attachmentId, name: safeName, mimeType, size: statSync(path).size, kind };
    this.index.set(attachmentId, { descriptor, path });
    return { attachment: descriptor };
  }
}

function sanitizeName(name: string): string {
  const safe = basename(name).replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 160).trim();
  return safe || "attachment";
}

function normalizeMime(mime: string, name: string, bytes: Buffer): string {
  const normalized = mime.split(";")[0]?.trim().toLowerCase();
  return normalized && normalized !== "application/octet-stream" ? normalized : detectMime(name, bytes);
}

function detectMime(path: string, bytes: Buffer): string {
  const ext = extname(path).toLowerCase();
  if (bytes.subarray(0, 4).toString("hex") === "25504446" || ext === ".pdf") return "application/pdf";
  if (bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (bytes.subarray(0, 3).toString("hex") === "ffd8ff") return "image/jpeg";
  if (bytes.subarray(0, 4).toString("ascii") === "GIF8") return "image/gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (TEXT_EXTENSIONS.has(ext)) return "text/plain";
  return "application/octet-stream";
}

function classify(name: string, mimeType: string, bytes: Buffer): AttachmentKind {
  if (IMAGE_MIMES.has(mimeType)) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("text/") || TEXT_EXTENSIONS.has(extname(name).toLowerCase())) {
    if (bytes.includes(0)) throw Object.assign(new Error(`“${name}” appears to be binary, not text.`), { code: "UNSUPPORTED_ATTACHMENT" });
    return "text";
  }
  throw Object.assign(new Error(`“${name}” is not a supported chat attachment. Use text/code, PDF, PNG, JPEG, WebP, or GIF.`), { code: "UNSUPPORTED_ATTACHMENT" });
}

function decodeText(bytes: Buffer, name: string): string {
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  if (text.includes("\uFFFD")) throw Object.assign(new Error(`“${name}” is not valid UTF-8 text.`), { code: "UNSUPPORTED_ATTACHMENT" });
  return text;
}

function extractPdf(path: string): string {
  try {
    return execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8", timeout: 20_000, maxBuffer: 10 * 1024 * 1024 });
  } catch {
    throw Object.assign(new Error("PDF text extraction requires the pdftotext utility on this Linux system."), { code: "MISSING_CAPABILITY" });
  }
}
