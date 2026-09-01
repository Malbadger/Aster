import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GeminiCliService } from "./gemini-cli.js";

function fixture(authType?: string) {
  const root = mkdtempSync(join(tmpdir(), "aster-gemini-root-"));
  const home = mkdtempSync(join(tmpdir(), "aster-gemini-home-"));
  const bundle = join(root, "node_modules", "@google", "gemini-cli", "bundle");
  mkdirSync(bundle, { recursive: true });
  writeFileSync(join(bundle, "gemini.js"), "if (process.argv.includes('--version')) console.log('0.57.0');\n");
  if (authType) {
    mkdirSync(join(home, ".gemini"), { recursive: true });
    writeFileSync(join(home, ".gemini", "settings.json"), JSON.stringify({ security: { auth: { selectedType: authType } } }));
  }
  return { root, home };
}

describe("GeminiCliService", () => {
  it("reports the bundled official CLI and Google account selection", async () => {
    const { root, home } = fixture("oauth-personal");
    await expect(new GeminiCliService(root, home).status()).resolves.toEqual({ installed: true, configured: true, version: "0.57.0", authType: "oauth-personal" });
  });

  it("does not mistake API-key configuration for account login", async () => {
    const { root, home } = fixture("gemini-api-key");
    await expect(new GeminiCliService(root, home).status()).resolves.toEqual({ installed: true, configured: false, version: "0.57.0", authType: "gemini-api-key" });
  });

  it("reports a missing packaged CLI cleanly", async () => {
    const root = mkdtempSync(join(tmpdir(), "aster-no-gemini-"));
    await expect(new GeminiCliService(root, root).status()).resolves.toEqual({ installed: false, configured: false });
  });
});
