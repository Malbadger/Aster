import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { registerCustomProviders } from "../../src/pi-adapter/custom-provider.js";

describe("custom Pi provider registration", () => {
  it("registers protocol, endpoint, auth reference, and all models in Pi", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aster-pi-provider-"));
    const runtime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, refreshOnCreate: false });
    registerCustomProviders(runtime, [{
      id: "acme", name: "Acme Enterprise", baseUrl: "https://models.acme.example/v1", api: "openai-responses",
      locality: "any", apiKeyReference: "ACME_API_KEY", authHeader: true, headers: { "x-tenant": "ACME_TENANT" },
      models: [{ id: "acme-code", name: "Acme Code", reasoning: true, vision: true, contextWindow: 64_000, maxTokens: 8_192 }],
    }]);
    expect(runtime.getRegisteredProviderIds()).toContain("acme");
    expect(runtime.getRegisteredProviderConfig("acme")).toEqual(expect.objectContaining({ baseUrl: "https://models.acme.example/v1", api: "openai-responses", apiKey: "ACME_API_KEY" }));
    expect(runtime.getModel("acme", "acme-code")).toEqual(expect.objectContaining({ provider: "acme", id: "acme-code", reasoning: true, input: ["text", "image"], contextWindow: 64_000, maxTokens: 8_192 }));
  });
});
