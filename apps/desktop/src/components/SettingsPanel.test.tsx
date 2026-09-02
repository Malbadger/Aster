import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel.js";

const base = {
  tab: "appearance" as const, theme: "graphite" as const, editorEngine: "vscode-oss" as const, connections: [], providerState: "empty" as const, authProviders: [],
  onTab: vi.fn(), onTheme: vi.fn(), onEditorEngine: vi.fn(), onClose: vi.fn(), onAddConnection: vi.fn(), onRemoveConnection: vi.fn(),
  onSetConnectionEnabled: vi.fn(), onCheckConnection: vi.fn(), onAuthenticate: vi.fn(),
  mcpServers: [], onMcpUpsert: vi.fn(), onMcpImport: vi.fn(), onMcpSetEnabled: vi.fn(), onMcpTest: vi.fn(), onMcpRemove: vi.fn(),
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
    render(<SettingsPanel {...base} tab="usage" usage={{ measuredSince: "2026-01-01T00:00:00.000Z", providers: [{ provider: "anthropic", input: 1200, output: 300, total: 1500, models: [{ model: "claude-sonnet", input: 1200, output: 300, total: 1500 }] }] }} />);
    expect(screen.getByText("Token usage")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getAllByText("1.5K tokens")).toHaveLength(2);
    expect(screen.getByText("claude-sonnet")).toBeInTheDocument();
  });
});
