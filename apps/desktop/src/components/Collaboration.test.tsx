import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskHistory } from "./TaskHistory.js";
import { SourceControl } from "./SourceControl.js";
import { LoggingSettings } from "./LoggingSettings.js";
import type { GitStatus, LogPolicy, RemoteConfirmation, Task } from "@law/contracts";

const tasks: Task[] = [{ taskId: "t1", title: "Fix parser", status: "active", createdAt: "", updatedAt: "" }];

describe("TaskHistory", () => {
  it("is searchable and offers working chat deletion without an inert evidence action", () => {
    const onDelete = vi.fn();
    render(<TaskHistory tasks={tasks} state="ready" query="" onQueryChange={() => {}} onOpen={() => {}} onDelete={onDelete} />);
    expect(screen.getByLabelText("Search tasks")).toBeInTheDocument();
    expect(screen.queryByText("Evidence")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete Fix parser" }));
    expect(onDelete).toHaveBeenCalledWith("t1");
  });
});

const status: GitStatus = { branch: "main", ahead: 1, behind: 0, clean: false, files: [{ path: "a.ts", state: "unstaged" }] };
const confirmation: RemoteConfirmation = { repository: "/repo", remote: "origin", branch: "main", effect: "push" };

describe("SourceControl remote guard (RULE-D-007)", () => {
  it("requires explicit confirmation naming the exact scope before pushing", () => {
    const onConfirm = vi.fn();
    const onRequest = vi.fn();
    const { rerender } = render(
      <SourceControl status={status} onStage={() => {}} onCommit={() => {}} onRequestRemote={onRequest} onConfirmRemote={onConfirm} onCancelRemote={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Push…" }));
    expect(onRequest).toHaveBeenCalledWith("push");
    // Once the daemon returns the required scope, the dialog names it exactly.
    rerender(<SourceControl status={status} pendingConfirmation={confirmation} onStage={() => {}} onCommit={() => {}} onRequestRemote={onRequest} onConfirmRemote={onConfirm} onCancelRemote={() => {}} />);
    expect(screen.getByRole("alertdialog", { name: "Confirm remote action" })).toHaveTextContent("origin/main");
    fireEvent.click(screen.getByRole("button", { name: "Confirm push" }));
    expect(onConfirm).toHaveBeenCalledWith(confirmation);
  });
});

describe("LoggingSettings (RULE-D-005)", () => {
  it("lets an unmanaged user change mode", () => {
    const onSet = vi.fn();
    const policy: LogPolicy = { mode: "off", managed: false, fields: [], retentionDays: 30, destination: "local-jsonl" };
    render(<LoggingSettings policy={policy} onSetMode={onSet} />);
    fireEvent.click(screen.getByLabelText(/User-managed/));
    expect(onSet).toHaveBeenCalledWith("user");
  });

  it("shows a Managed indicator and disables controls when managed", () => {
    const policy: LogPolicy = { mode: "managed", managed: true, fields: ["event"], retentionDays: 90, destination: "local-jsonl" };
    render(<LoggingSettings policy={policy} onSetMode={() => {}} />);
    expect(screen.getByLabelText("Managed logging in force")).toBeInTheDocument();
    expect(screen.getByLabelText(/User-managed/)).toBeDisabled();
  });
});
