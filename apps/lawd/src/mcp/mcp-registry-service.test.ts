import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpRegistryService } from "./mcp-registry-service.js";

describe("McpRegistryService", () => {
  it("imports standard JSON, generates Claude config, and discovers tools", async () => {
    const root = mkdtempSync(join(tmpdir(), "aster-mcp-registry-"));
    try {
      const service = new McpRegistryService(join(root, "mcp.json"), async () => ["search", "read"]);
      const imported = service.importJson(JSON.stringify({ mcpServers: { docs: { command: "npx", args: ["server"], env: { API_TOKEN: "${DOCS_TOKEN}" } } } }));
      expect(imported.imported).toBe(1);
      expect((await service.test("docs")).server.tools).toEqual(["search", "read"]);
      expect(readFileSync(service.claudeConfigPath, "utf8")).not.toContain("DOCS_TOKEN");
      expect(service.setEnabled("docs", false).server.server.enabled).toBe(false);
      expect(service.remove("docs")).toEqual({ removed: true });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("refuses literal credential values in imported JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "aster-mcp-secrets-"));
    try {
      const service = new McpRegistryService(join(root, "mcp.json"));
      expect(() => service.importJson(JSON.stringify({ mcpServers: { risky: { command: "x", env: { API_KEY: "literal-secret" } } } }))).toThrow(/placeholder/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
