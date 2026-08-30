import { describe, expect, it } from "vitest";
import { AutocompleteService } from "./autocomplete.js";

describe("AutocompleteService (REQ-D-031/032)", () => {
  it("is disabled by default and refuses with a reason", async () => {
    const svc = new AutocompleteService(() => "nope");
    const r = await svc.complete({ path: "a.ts", prefix: "const ", suffix: "" });
    expect(r.enabled).toBe(false);
    expect(r.suggestion).toBeUndefined();
    expect(r.reason).toMatch(/disabled/);
  });

  it("refuses when enabled but no model configured", async () => {
    const svc = new AutocompleteService(() => "x");
    svc.setConfig({ enabled: true, locality: "local", maxTokens: 32 });
    const r = await svc.complete({ path: "a.ts", prefix: "x", suffix: "" });
    expect(r.enabled).toBe(true);
    expect(r.suggestion).toBeUndefined();
    expect(r.reason).toMatch(/no autocomplete model/);
  });

  it("completes and discloses locality when configured", async () => {
    const svc = new AutocompleteService((req) => `${req.prefix}World`);
    svc.setConfig({ enabled: true, modelId: "ollama:code", locality: "local", maxTokens: 32 });
    const r = await svc.complete({ path: "a.ts", prefix: "Hello ", suffix: "" });
    expect(r.suggestion).toBe("Hello World");
    expect(r.locality).toBe("local");
  });
});
