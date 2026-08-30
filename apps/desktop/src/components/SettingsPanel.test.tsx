import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel.js";

const base = {
  tab: "appearance" as const, theme: "graphite" as const, connections: [], providerState: "empty" as const,
  onTab: vi.fn(), onTheme: vi.fn(), onClose: vi.fn(), onAddConnection: vi.fn(), onRemoveConnection: vi.fn(),
  onSetConnectionEnabled: vi.fn(), onCheckConnection: vi.fn(), onLoginProvider: vi.fn(),
};

describe("SettingsPanel", () => {
  it("selects a persisted color theme intent", () => {
    const onTheme = vi.fn(); render(<SettingsPanel {...base} onTheme={onTheme} />);
    fireEvent.click(screen.getByRole("button", { name: /Midnight/ }));
    expect(onTheme).toHaveBeenCalledWith("midnight");
  });

  it("navigates to provider connections", () => {
    const onTab = vi.fn(); render(<SettingsPanel {...base} onTab={onTab} />);
    fireEvent.click(screen.getByRole("button", { name: "Providers" }));
    expect(onTab).toHaveBeenCalledWith("providers");
  });
});
