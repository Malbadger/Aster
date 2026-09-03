import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPanel, type SettingsPanelProps } from "./SettingsPanel.js";

const base: SettingsPanelProps = {
  tab: "appearance" as const, theme: "graphite" as const, editorEngine: "vscode-oss" as const, connections: [], providerState: "empty" as const, authProviders: [],
  onTab: vi.fn(), onTheme: vi.fn(), onEditorEngine: vi.fn(), onClose: vi.fn(), onAddConnection: vi.fn(), onRemoveConnection: vi.fn(),
  onSetConnectionEnabled: vi.fn(), onCheckConnection: vi.fn(), onAuthenticate: vi.fn(),
  mcpServers: [], onMcpUpsert: vi.fn(), onMcpImport: vi.fn(), onMcpSetEnabled: vi.fn(), onMcpTest: vi.fn(), onMcpRemove: vi.fn(),
  models: [{ id: "ollama:qwen", displayName: "Qwen", provider: "ollama", locality: "local", availability: "available", effort: { supported: ["medium" as const] }, capabilities: { tools: true, vision: false } }], providerDefaults: {}, onSetProviderDefault: vi.fn(),
};

describe("SettingsPanel", () => {
  it("selects a persisted color theme intent", () => {
    const onTheme = vi.fn(); render(<SettingsPanel {...base} onTheme={onTheme} />);
    fireEvent.click(screen.getByRole("button", { name: /Catppuccin Mocha/ }));
    expect(onTheme).toHaveBeenCalledWith("catppuccin-mocha");
  });

  it("navigates to provider connections", () => {
    const onTab = vi.fn(); render(<SettingsPanel {...base} onTab={onTab} />);
    fireEvent.click(screen.getByRole("button", { name: "Providers" }));
    expect(onTab).toHaveBeenCalledWith("providers");
  });

  it("shows VSCodium as the sole editor", () => {
    render(<SettingsPanel {...base} tab="about" />);
    expect(screen.getByText("VSCodium")).toBeInTheDocument();
    expect(screen.queryByText(/Neovim/)).toBeNull();
  });

  it("labels the product information section About", () => {
    render(<SettingsPanel {...base} />);
    expect(screen.getByRole("button", { name: "About" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "General" })).toBeNull();
  });

  it("keeps measured token usage in its own settings page", () => {
    render(<SettingsPanel {...base} tab="usage" usage={{ measuredSince: "2026-01-01T00:00:00.000Z", providers: [{ provider: "anthropic", input: 1200, output: 300, total: 1500, turns: 1, models: [{ model: "claude-sonnet", input: 1200, output: 300, total: 1500, turns: 1 }] }] }} />);
    expect(screen.getByText("Token processing")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getAllByText("1.5K tokens")).toHaveLength(2);
    expect(screen.getByText("claude-sonnet")).toBeInTheDocument();
  });

  it("sets an exact default model for each provider", () => {
    const onSetProviderDefault = vi.fn();
    render(<SettingsPanel {...base} tab="models" onSetProviderDefault={onSetProviderDefault} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Ollama default model" }), { target: { value: "ollama:qwen" } });
    expect(onSetProviderDefault).toHaveBeenCalledWith("ollama", "ollama:qwen");
    expect(screen.getByText(/never substitutes/i)).toBeInTheDocument();
  });
});
