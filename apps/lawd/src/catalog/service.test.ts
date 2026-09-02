import { describe, expect, it } from "vitest";
import { CatalogService } from "./service.js";
import { MemoryPreferencesStore } from "./preferences.js";
import type { ModelSourcePort } from "../ports.js";
import type { ModelDescriptor } from "@law/contracts";

const models: ModelDescriptor[] = [
  { id: "ollama:zephyr", displayName: "Zephyr", provider: "ollama", locality: "local", availability: "available", effort: { supported: ["low", "medium"] }, capabilities: { tools: false, vision: false } },
  { id: "ollama:alpaca", displayName: "Alpaca", provider: "ollama", locality: "local", availability: "available", effort: { supported: ["low"] }, capabilities: { tools: false, vision: false } },
  { id: "acme:pro", displayName: "Pro", provider: "acme", locality: "remote", availability: "auth-needed", effort: { supported: ["minimal", "low", "medium", "high", "max"] }, capabilities: { tools: true, vision: false } },
];

const source: ModelSourcePort = { async descriptors() { return models; } };

describe("CatalogService", () => {
  it("orders favorites first, then alphabetical (RULE-D-001)", async () => {
    const svc = new CatalogService(source, new MemoryPreferencesStore({ favorites: ["acme:pro"] }));
    const cat = await svc.listCatalog("");
    expect(cat.models[0]!.id).toBe("acme:pro");
    expect(cat.models.slice(1).map((m) => m.id)).toEqual(["ollama:alpaca", "ollama:zephyr"]);
  });

  it("persists favorite toggles", async () => {
    const prefs = new MemoryPreferencesStore();
    const svc = new CatalogService(source, prefs);
    expect(svc.setFavorite("ollama:zephyr", true).favorites).toEqual(["ollama:zephyr"]);
    const cat = await svc.listCatalog("");
    expect(cat.models[0]!.id).toBe("ollama:zephyr");
    expect(svc.setFavorite("ollama:zephyr", false).favorites).toEqual([]);
  });

  it("filters by query", async () => {
    const svc = new CatalogService(source, new MemoryPreferencesStore());
    const cat = await svc.listCatalog("alp");
    expect(cat.models.map((m) => m.id)).toEqual(["ollama:alpaca"]);
  });

  it("resolves supported effort and refuses unsupported (RULE-D-002)", async () => {
    const svc = new CatalogService(source, new MemoryPreferencesStore());
    expect((await svc.resolveEffort("ollama:alpaca", "low")).supported).toBe(true);
    const refused = await svc.resolveEffort("ollama:alpaca", "max");
    expect(refused.supported).toBe(false);
    expect(refused.reason).toMatch(/refused/i);
  });

  it("reports an unknown model rather than guessing", async () => {
    const svc = new CatalogService(source, new MemoryPreferencesStore());
    const r = await svc.resolveEffort("nope:nope", "low");
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/not in the current catalog/);
  });

  it("resolves a configured provider default without guessing", async () => {
    const svc = new CatalogService(source, new MemoryPreferencesStore({ providerDefaults: { ollama: "ollama:zephyr" } }));
    const resolved = await svc.resolveTarget({ provider: "ollama" });
    expect(resolved).toMatchObject({ source: "provider-default", model: { id: "ollama:zephyr" } });
  });

  it("uses an explicit model before a provider default", async () => {
    const svc = new CatalogService(source, new MemoryPreferencesStore({ providerDefaults: { ollama: "ollama:zephyr" } }));
    const resolved = await svc.resolveTarget({ provider: "ollama", modelId: "ollama:alpaca" });
    expect(resolved).toMatchObject({ source: "explicit", model: { id: "ollama:alpaca" } });
  });

  it("refuses missing, mismatched, and unavailable defaults without substitution", async () => {
    const svc = new CatalogService(source, new MemoryPreferencesStore());
    await expect(svc.resolveTarget({ provider: "ollama" })).rejects.toThrow(/no default model/);
    await expect(svc.resolveTarget({ provider: "ollama", modelId: "acme:pro" })).rejects.toThrow(/belongs to provider/);
    await expect(svc.setProviderDefault("acme", "acme:pro")).rejects.toThrow(/not currently available/);
  });

  it("stores and clears a validated provider default", async () => {
    const svc = new CatalogService(source, new MemoryPreferencesStore());
    expect((await svc.setProviderDefault("ollama", "ollama:zephyr")).defaults).toEqual({ ollama: "ollama:zephyr" });
    expect((await svc.listCatalog("")).defaults).toEqual({ ollama: "ollama:zephyr" });
    expect((await svc.setProviderDefault("ollama")).defaults).toEqual({});
  });
});
