import { describe, expect, it } from "vitest";
import { applyDisambiguation, filterModels, orderModels, resolveEffort } from "./model-order.js";
import type { ModelDescriptor } from "./model.js";

function m(part: Partial<ModelDescriptor> & { id: string; displayName: string }): ModelDescriptor {
  return {
    provider: "ollama",
    locality: "local",
    availability: "available",
    effort: { supported: ["low", "medium", "high"] },
    capabilities: { tools: false, vision: false },
    ...part,
  };
}

describe("catalog ordering (RULE-D-001)", () => {
  it("puts favorites first, then recent, then alphabetical by display name", () => {
    const models = [
      m({ id: "a", displayName: "Zephyr" }),
      m({ id: "b", displayName: "Alpaca" }),
      m({ id: "c", displayName: "Mistral" }),
      m({ id: "d", displayName: "Beluga" }),
    ];
    const ordered = orderModels(models, ["c"], ["d"]);
    expect(ordered.map((x) => x.id)).toEqual(["c", "d", "b", "a"]);
    // c=favorite, d=recent, then Alpaca(b), Zephyr(a) by name
  });

  it("preserves recency order among recent models", () => {
    const models = [m({ id: "x", displayName: "X" }), m({ id: "y", displayName: "Y" })];
    const ordered = orderModels(models, [], ["y", "x"]); // y is most recent
    expect(ordered.map((x) => x.id)).toEqual(["y", "x"]);
  });

  it("disambiguates duplicate display names with secondary label", () => {
    const models = applyDisambiguation([
      m({ id: "ollama:llama3", displayName: "Llama 3", provider: "ollama", locality: "local" }),
      m({ id: "remote:llama3", displayName: "Llama 3", provider: "acme", locality: "remote" }),
      m({ id: "solo", displayName: "Solo" }),
    ]);
    expect(models[0]!.secondaryLabel).toBeDefined();
    expect(models[1]!.secondaryLabel).toBeDefined();
    expect(models[2]!.secondaryLabel).toBeUndefined();
  });

  it("filters case-insensitively across name/provider/id", () => {
    const models = [
      m({ id: "ollama:llama3.1", displayName: "Llama 3.1", provider: "ollama" }),
      m({ id: "acme:gpt", displayName: "GPT-ish", provider: "acme" }),
    ];
    expect(filterModels(models, "llama").map((x) => x.id)).toEqual(["ollama:llama3.1"]);
    expect(filterModels(models, "ACME").map((x) => x.id)).toEqual(["acme:gpt"]);
  });
});

describe("effort resolution (RULE-D-002)", () => {
  it("maps a supported level to itself", () => {
    const r = resolveEffort(m({ id: "a", displayName: "A" }), "medium");
    expect(r.supported).toBe(true);
    expect(r.effective).toBe("medium");
  });

  it("refuses an unsupported level with a reason, never silently ignores", () => {
    const r = resolveEffort(m({ id: "a", displayName: "A", effort: { supported: ["low"] } }), "max");
    expect(r.supported).toBe(false);
    expect(r.effective).toBeUndefined();
    expect(r.reason).toMatch(/refused/i);
  });
});
