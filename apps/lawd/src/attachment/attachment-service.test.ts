import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AttachmentService } from "./attachment-service.js";

describe("AttachmentService", () => {
  it("privately stages and resolves UTF-8 text without exposing its body in metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "aster-attachments-"));
    const source = join(root, "notes.md");
    writeFileSync(source, "# Review me\n");
    const service = new AttachmentService(root);
    const { attachment } = service.importPath(source);
    expect(attachment).toMatchObject({ name: "notes.md", mimeType: "text/plain", kind: "text", size: 12 });
    expect(attachment).not.toHaveProperty("content");
    expect(service.resolve([attachment.attachmentId])[0]?.text).toBe("# Review me\n");
  });

  it("accepts supported pasted images and rejects arbitrary binary files", () => {
    const root = mkdtempSync(join(tmpdir(), "aster-attachments-"));
    const service = new AttachmentService(root);
    const png = Buffer.from("89504e470d0a1a0a", "hex");
    const image = service.stageBase64("capture.png", "image/png", png.toString("base64")).attachment;
    expect(service.resolve([image.attachmentId])[0]).toMatchObject({ kind: "image", dataBase64: png.toString("base64") });
    expect(() => service.stageBase64("archive.bin", "application/octet-stream", Buffer.from([1, 2, 3]).toString("base64"))).toThrow(/not a supported chat attachment/);
    expect(() => service.stageBase64("broken.png", "image/png", "not!base64")).toThrow(/not valid base64/);
  });
});
