import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { App } from "./App.js";
import { DESKTOP_VERSION, type ModelDescriptor } from "@law/contracts";
import type { IpcClient } from "./ipc/client.js";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const ollamaModel: ModelDescriptor = { id: "ollama:qwen", displayName: "Qwen:latest", provider: "ollama", locality: "local", availability: "available", effort: { supported: ["low", "medium", "high"] }, capabilities: { tools: true, vision: false } };
const remoteModel: ModelDescriptor = { id: "openai-codex:gpt-test", displayName: "GPT Test", provider: "openai-codex", locality: "remote", availability: "available", effort: { supported: ["low", "medium", "high", "max"] }, capabilities: { tools: true, vision: false } };
const opus48: ModelDescriptor = { ...remoteModel, id: "anthropic:claude-opus-4-8", displayName: "Claude Opus 4.8", provider: "anthropic" };
const opus5: ModelDescriptor = { ...remoteModel, id: "anthropic:claude-opus-5", displayName: "Claude Opus 5", provider: "anthropic" };

function client(models: ModelDescriptor[] = [ollamaModel]): IpcClient {
  return {
    call: async (op) => {
      switch (op.name) {
        case "daemon_get_health": return { daemonVersion: DESKTOP_VERSION, protocol: 1, dataSchemaVersion: 1, uptimeMs: 1, offlineLocalOnly: true };
        case "daemon_probe_capabilities": return { probedAt: new Date(0).toISOString(), capabilities: [{ id: "core", displayName: "Aster Core", state: "ready", optional: false, detail: "Ready" }] };
        case "model_list_catalog": return { models, favorites: [], recent: [], defaults: {} };
        case "task_list": return { tasks: [] };
        case "provider_list_connections": return { connections: [] };
        case "provider_auth_methods": return { providers: [] };
        case "provider_gemini_cli_status": return { installed: true, configured: false, version: "0.57.0" };
        case "workspace_get_root": return { path: "/home/test" };
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
    expect(screen.queryByRole("combobox", { name: "Reasoning effort" })).toBeNull();
  });

  it("shows effort for supported remote models and sends the selected Full Access mode", async () => {
    const sent: unknown[] = [];
    const base = client([remoteModel]);
    const modeClient = {
      call: async (op: { name: string }, payload: unknown) => {
        if (op.name === "task_create") return { task: { taskId: "task-1", title: "New chat", status: "active", createdAt: "", updatedAt: "" } };
        if (op.name === "task_send_message") { sent.push(payload); return { accepted: true, interpretation: { type: "natural" }, status: "completed", nextSeq: 0 }; }
        if (op.name === "task_get_events") return { events: [], nextSeq: 0, taskStatus: "completed" };
        return base.call(op as never, payload as never);
      },
    } as IpcClient;
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App client={modeClient} />);
    const box = await screen.findByRole("textbox", { name: "Message" });
    expect(screen.getByRole("combobox", { name: "Reasoning effort" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Execution mode" }), { target: { value: "full-access" } });
    fireEvent.change(box, { target: { value: "implement this" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual(expect.objectContaining({ identity: expect.objectContaining({ mode: "full-access", model: remoteModel.id }) }));
    confirm.mockRestore();
  });

  it("keeps the selected coordinator distinct from its provider default", async () => {
    localStorage.removeItem("aster.desktop.active-model.v1");
    const calls: Array<{ op: string; payload: unknown }> = [];
    const base = client([opus48, opus5]);
    const identityClient = {
      call: async (op: { name: string }, payload: unknown) => {
        calls.push({ op: op.name, payload });
        if (op.name === "model_list_catalog") return { models: [opus48, opus5], favorites: [], recent: [], defaults: { anthropic: opus48.id } };
        if (op.name === "task_create") return { task: { taskId: "task-opus", title: "New chat", status: "active", createdAt: "", updatedAt: "" } };
        if (op.name === "task_send_message") return { accepted: true, interpretation: { type: "natural-language", summary: "chat" }, status: "completed", nextSeq: 0 };
        if (op.name === "task_get_events") return { events: [], nextSeq: 0, taskStatus: "completed" };
        return base.call(op as never, payload as never);
      },
    } as IpcClient;
    render(<App client={identityClient} />);
    const box = await screen.findByRole("textbox", { name: "Message" });
    fireEvent.click(screen.getByRole("button", { name: /Claude Opus 4\.8/ }));
    fireEvent.click(screen.getByRole("option", { name: /Claude Opus 5/ }));
    fireEvent.change(box, { target: { value: "coordinate this" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(calls.some(({ op }) => op === "task_send_message")).toBe(true));
    const created = calls.find(({ op }) => op === "task_create")?.payload as { defaultIdentity: { model: string } };
    const sent = calls.find(({ op }) => op === "task_send_message")?.payload as { identity: { model: string } };
    expect(created.defaultIdentity.model).toBe(opus5.id);
    expect(sent.identity.model).toBe(opus5.id);
    expect(created.defaultIdentity.model).not.toBe(opus48.id);
  });

  it("keeps the default native client stable across boot state updates", async () => {
    invoke.mockImplementation(async (command, args: { request: { id: string; op: string; schemaVersion: number } }) => {
      if (command === "home_directory") return "/home/test";
      const { id, op, schemaVersion } = args.request;
      const results: Record<string, unknown> = {
        daemon_get_health: { daemonVersion: DESKTOP_VERSION, protocol: 1, dataSchemaVersion: 1, uptimeMs: 1, offlineLocalOnly: true },
        daemon_probe_capabilities: { probedAt: new Date(0).toISOString(), capabilities: [{ id: "core", displayName: "Aster Core", state: "ready", optional: false, detail: "Ready" }] },
        model_list_catalog: { models: [], favorites: [], recent: [], defaults: {} },
        task_list: { tasks: [] },
        provider_list_connections: { connections: [] },
        provider_auth_methods: { providers: [] },
        provider_gemini_cli_status: { installed: true, configured: false, version: "0.57.0" },
        workspace_get_root: { path: "/home/test" },
      };
      return { protocol: 1, id, op, schemaVersion, ok: true, result: results[op] };
    });
    render(<App />);
    await screen.findByRole("textbox", { name: "Message" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invoke.mock.calls.filter(([, args]) => args?.request?.op === "daemon_get_health")).toHaveLength(1);
  });
});
