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
    fireEvent.click(screen.getByRole("button", { name: "Explorer" }));
    expect(onToggle).toHaveBeenCalledWith("fileTree");
  });

  it("docks terminal below the primary workspace", () => {
    const onToggle = vi.fn();
    render(<WorkspaceShell layout={{ ...DEFAULT_LAYOUT, terminal: true }} activePanel="terminal" slots={{ terminal: <div>terminal-content</div> }} onToggle={onToggle} onPreset={() => {}} onReset={() => {}} />);
    expect(screen.getByText("terminal-content")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close bottom panel" }));
    expect(onToggle).toHaveBeenCalledWith("terminal");
  });

  it("exposes keyboard-accessible pane resize handles", () => {
    render(<WorkspaceShell layout={{ ...DEFAULT_LAYOUT, editor: true, terminal: true }} activePanel="terminal" slots={{ chat: <div>chat</div>, editor: <div>editor</div>, terminal: <div>terminal</div> }} onToggle={() => {}} onPreset={() => {}} onReset={() => {}} />);
    expect(screen.getByRole("separator", { name: "Resize chat and editor" })).toHaveAttribute("aria-orientation", "vertical");
    expect(screen.getByRole("separator", { name: "Resize Terminal" })).toHaveAttribute("aria-orientation", "horizontal");
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
