import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StartSurface } from "./StartSurface.js";
import { FirstRunSetup } from "./FirstRunSetup.js";
import type { CapabilityProbe } from "@law/contracts";

describe("StartSurface", () => {
  it("offers all six entry points without workflow setup", () => {
    render(<StartSurface recents={[]} state="empty" onAction={() => {}} onOpenRecent={() => {}} />);
    for (const label of ["Open Folder", "Clone Repository", "New Workspace", "Open Recent", "New Chat", "Open File"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it("emits the chosen action", () => {
    const onAction = vi.fn();
    render(<StartSurface recents={[]} state="empty" onAction={onAction} onOpenRecent={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /New Chat/ }));
    expect(onAction).toHaveBeenCalledWith("new-chat");
  });

  it("shows an empty recent state distinct from error", () => {
    const { rerender } = render(<StartSurface recents={[]} state="empty" onAction={() => {}} onOpenRecent={() => {}} />);
    expect(screen.getByText(/No recent workspaces or tasks/)).toBeInTheDocument();
    rerender(<StartSurface recents={[]} state="error" errorMessage="disk error" onAction={() => {}} onOpenRecent={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("disk error");
  });
});

const probe: CapabilityProbe = {
  probedAt: new Date().toISOString(),
  capabilities: [
    { id: "law-core", displayName: "LAW Core", state: "ready", optional: false, detail: "ok" },
    { id: "pi", displayName: "Pi", state: "missing", optional: false, detail: "not installed", recovery: "install Pi" },
    { id: "git", displayName: "Git", state: "ready", optional: true, detail: "git 2.x" },
  ],
};

describe("FirstRunSetup", () => {
  it("blocks Continue while a required capability is not ready", () => {
    render(<FirstRunSetup probe={probe} onContinue={() => {}} onRetry={() => {}} />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByText(/install Pi/)).toBeInTheDocument();
  });

  it("allows Continue once required capabilities are ready", () => {
    const ok: CapabilityProbe = {
      probedAt: probe.probedAt,
      capabilities: [
        { id: "law-core", displayName: "LAW Core", state: "ready", optional: false, detail: "ok" },
        { id: "git", displayName: "Git", state: "unavailable", optional: true, detail: "no git" },
      ],
    };
    const onContinue = vi.fn();
    render(<FirstRunSetup probe={ok} onContinue={onContinue} onRetry={() => {}} />);
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont).not.toBeDisabled();
    fireEvent.click(cont);
    expect(onContinue).toHaveBeenCalled();
  });
});
