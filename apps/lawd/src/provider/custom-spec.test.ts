import { describe, expect, it } from "vitest";
import type { ProviderConnection } from "@law/contracts";
import { customProviderSpecs, toCustomProviderSpec } from "./custom-spec.js";

const endpoint = {
  baseUrl: "https://api.example.test/v1",
  api: "openai-completions" as const,
  authHeader: true,
  headers: [{ name: "x-tenant", valueReference: "TENANT_ID" }],
  models: [{ id: "example-code", name: "Example Code", reasoning: true, vision: false, contextWindow: 32_000, maxTokens: 4_096 }],
};

function connection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return { connectionId: "c1", provider: "example", label: "Example", authMethod: "env-var", locality: "remote", enabled: true, status: "unknown", referenceHint: "EXAMPLE_KEY", endpoint, ...overrides };
}

describe("custom provider config conversion", () => {
  it("maps env references and model metadata without resolving secrets", () => {
    expect(toCustomProviderSpec(connection())).toEqual(expect.objectContaining({
      id: "example", apiKeyReference: "EXAMPLE_KEY", locality: "any", headers: { "x-tenant": "TENANT_ID" }, models: endpoint.models,
    }));
  });

  it("maps external commands and local no-auth endpoints to Pi references", () => {
    expect(toCustomProviderSpec(connection({ authMethod: "external-command", referenceHint: "secret-tool read example" }))?.apiKeyReference).toBe("!secret-tool read example");
    expect(toCustomProviderSpec(connection({ authMethod: "none-local", referenceHint: undefined, locality: "local" }))?.apiKeyReference).toBe("aster-local-no-auth");
  });

  it("excludes disabled and non-endpoint connections", () => {
    expect(customProviderSpecs([connection({ enabled: false }), connection({ endpoint: undefined })])).toEqual([]);
  });
});
