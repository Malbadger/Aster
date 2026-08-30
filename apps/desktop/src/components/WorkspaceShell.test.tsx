import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspaceShell } from "./WorkspaceShell.js";
import { DiffView } from "./DiffView.js";
import { DEFAULT_LAYOUT } from "../layout/layout.js";
import type { FileState, Hunk } from "@law/contracts";

describe("WorkspaceShell", () => {
  it("renders visible panels and toggles from the rail", () => {
    const onToggle = vi.fn();
    render(
      <WorkspaceShell
        layout={DEFAULT_LAYOUT}
        activePanel="chat"
        slots={{ chat: <div>chat-content</div> }}
        onToggle={onToggle}
        onPreset={() => {}}
        onReset={() => {}}
      />,
    );
    expect(screen.getByText("chat-content")).toBeInTheDocument();
    // Terminal is collapsed by default; the rail button exists.
    fireEvent.click(screen.getByRole("button", { name: "Toggle Terminal" }));
    expect(onToggle).toHaveBeenCalledWith("terminal");
  });

  it("offers layout presets and reset", () => {
    const onPreset = vi.fn();
    const onReset = vi.fn();
    render(<WorkspaceShell layout={DEFAULT_LAYOUT} activePanel="chat" slots={{}} onToggle={() => {}} onPreset={onPreset} onReset={onReset} />);
    fireEvent.change(screen.getByLabelText("Layout preset"), { target: { value: "Full Workspace" } });
    expect(onPreset).toHaveBeenCalledWith("Full Workspace");
    fireEvent.click(screen.getByRole("button", { name: "Reset layout" }));
    expect(onReset).toHaveBeenCalled();
  });
});

const staleState: FileState = { path: "a.ts", contentHash: "h2", provenance: "mixed", verification: "stale", verifiedHash: "h1" };
const hunks: Hunk[] = [
  { hunkId: "h1", oldStart: 2, oldLines: 1, newStart: 2, newLines: 1, lines: ["-old", "+new"], status: "pending", provenance: "model" },
];

describe("DiffView", () => {
  it("shows a stale-verification banner and accepts a hunk", () => {
    const onDecision = vi.fn();
    render(<DiffView path="a.ts" state={staleState} hunks={hunks} onHunkDecision={onDecision} onAcceptAll={() => {}} onRejectAll={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/prior verification no longer applies/);
    fireEvent.click(screen.getByRole("button", { name: "Accept hunk h1" }));
    expect(onDecision).toHaveBeenCalledWith("h1", "accepted");
  });
});
