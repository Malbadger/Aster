import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { App } from "./App.js";
import { DESKTOP_VERSION } from "@law/contracts";
import type { IpcClient } from "./ipc/client.js";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

function client(): IpcClient {
  return {
    call: async (op) => {
      switch (op.name) {
        case "daemon_get_health": return { daemonVersion: DESKTOP_VERSION, protocol: 1, dataSchemaVersion: 1, uptimeMs: 1, offlineLocalOnly: true };
        case "daemon_probe_capabilities": return { probedAt: new Date(0).toISOString(), capabilities: [{ id: "core", displayName: "Aster Core", state: "ready", optional: false, detail: "Ready" }] };
        case "model_list_catalog": return { models: [{ id: "ollama:qwen", displayName: "Qwen:latest", provider: "ollama", locality: "local", availability: "available", effort: { supported: ["low", "medium", "high"] }, capabilities: { tools: true, vision: false } }], favorites: [], recent: [] };
        case "task_list": return { tasks: [] };
        case "provider_list_connections": return { connections: [] };
        case "provider_auth_methods": return { providers: [] };
        default: throw new Error(`unexpected test operation ${op.name}`);
      }
    },
  } as IpcClient;
}

describe("App", () => {
  it("boots through the typed client directly into the accessible chat workspace", async () => {
    const { container } = render(<App client={client()} />);
    expect(screen.getByLabelText("Aster")).toBeInTheDocument();
    expect(screen.getByTestId("app-version")).toHaveTextContent(DESKTOP_VERSION);
    await screen.findByRole("textbox", { name: "Message" });
    const result = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(result.violations).toEqual([]);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toHaveFocus());
  });

  it("keeps the default native client stable across boot state updates", async () => {
    invoke.mockImplementation(async (_command, args: { request: { id: string; op: string; schemaVersion: number } }) => {
      const { id, op, schemaVersion } = args.request;
      const results: Record<string, unknown> = {
        daemon_get_health: { daemonVersion: DESKTOP_VERSION, protocol: 1, dataSchemaVersion: 1, uptimeMs: 1, offlineLocalOnly: true },
        daemon_probe_capabilities: { probedAt: new Date(0).toISOString(), capabilities: [{ id: "core", displayName: "Aster Core", state: "ready", optional: false, detail: "Ready" }] },
        model_list_catalog: { models: [], favorites: [], recent: [] },
        task_list: { tasks: [] },
        provider_list_connections: { connections: [] },
        provider_auth_methods: { providers: [] },
      };
      return { protocol: 1, id, op, schemaVersion, ok: true, result: results[op] };
    });
    render(<App />);
    await screen.findByRole("textbox", { name: "Message" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invoke.mock.calls.filter(([, args]) => args?.request?.op === "daemon_get_health")).toHaveLength(1);
  });
});
