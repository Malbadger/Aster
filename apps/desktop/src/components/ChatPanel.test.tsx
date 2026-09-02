import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel.js";
import type { ChatEvent } from "@law/contracts";

const events: ChatEvent[] = [
  { id: "e1", taskId: "t", seq: 0, at: "", kind: "user", text: "read a.ts" },
  { id: "e2", taskId: "t", seq: 1, at: "", kind: "assistant", text: "I’ll inspect it." },
  { id: "e3", taskId: "t", seq: 2, at: "", kind: "tool_denied", text: "tool not allowed", data: { callId: "c1" } },
  { id: "e4", taskId: "t", seq: 3, at: "", kind: "tool_result", text: "duplicate denial result", data: { callId: "c1", ok: false } },
];

describe("ChatPanel", () => {
  it("renders events chronologically with kind labels (no ribbon)", () => {
    render(<ChatPanel events={events} running={false} onSend={() => {}} onStop={() => {}} />);
    const items = screen.getByRole("list", { name: "Conversation" }).querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(screen.getByText("Tools")).toBeInTheDocument();
    expect(screen.getByText("1 need attention")).toBeInTheDocument();
    expect(screen.getByText("Guard")).toBeInTheDocument();
    expect(screen.queryByText("duplicate denial result")).toBeNull();
  });

  it("grows for a long prompt, then sends and returns to its compact height", async () => {
    const onSend = vi.fn();
    render(<ChatPanel events={[]} running={false} onSend={onSend} onStop={() => {}} />);
    const box = screen.getByLabelText("Message") as HTMLTextAreaElement;
    Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => box.value ? 190 : 96 });
    fireEvent.change(box, { target: { value: "do it\nwith a much longer prompt" } });
    await waitFor(() => expect(box.style.height).toBe("190px"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("do it\nwith a much longer prompt");
    await waitFor(() => expect(box).toHaveValue(""));
    await waitFor(() => expect(box.style.height).toBe("96px"));
  });

  it("shows Stop instead of Send while running", () => {
    const onStop = vi.fn();
    render(<ChatPanel events={[]} running={true} onSend={() => {}} onStop={onStop} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.getByText("Thinking")).toBeInTheDocument();
  });

  it("keeps low-level status events out of the conversation", () => {
    render(<ChatPanel events={[{ id: "s", taskId: "t", seq: 0, at: "", kind: "status", text: "Phase completed." }]} running={false} onSend={() => {}} onStop={() => {}} />);
    expect(screen.queryByText("Phase completed.")).toBeNull();
  });

  it("hides a legacy assistant event that exactly echoes the preceding user turn", () => {
    render(<ChatPanel events={[
      { id: "u", taskId: "t", seq: 0, at: "", kind: "user", text: "are you running?" },
      { id: "a", taskId: "t", seq: 1, at: "", kind: "assistant", text: "are you running?" },
    ]} running={false} onSend={() => {}} onStop={() => {}} />);
    expect(screen.getAllByText("are you running?")).toHaveLength(1);
  });

  it("attributes a model response to the model that produced it", () => {
    render(<ChatPanel events={[{
      id: "a", taskId: "t", phaseId: "p", seq: 0, at: "", kind: "assistant", text: "Done.",
      data: { identity: { provider: "openai-codex", model: "gpt-5.6-sol", effort: "high" } },
    }]} running={false} onSend={() => {}} onStop={() => {}} />);
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.6-sol").closest("small")).toHaveAttribute("title", "OpenAI · gpt-5.6-sol");
  });

  it("marks official Claude responses without exposing the bridge shell", () => {
    render(<ChatPanel events={[{
      id: "claude", taskId: "t", phaseId: "p", seq: 0, at: "", kind: "assistant", text: "Reviewed.",
      data: { identity: { provider: "anthropic", model: "claude-sonnet-4-6", effort: "medium" } },
    }]} running={false} onSend={() => {}} onStop={() => {}} />);
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6").closest("small")).toHaveAttribute("title", "Claude Code · claude-sonnet-4-6");
    expect(screen.queryByText(/claude -p/)).toBeNull();
  });

  it("shows attachment chips, removes them, and waits for send preflight", async () => {
    const onSend = vi.fn(); const onRemove = vi.fn(); const onBeforeSend = vi.fn(async () => false);
    render(<ChatPanel events={[]} running={false} onSend={onSend} onStop={() => {}} onBeforeSend={onBeforeSend}
      attachments={[{ attachmentId: "att-1", name: "design.md", mimeType: "text/plain", size: 2048, kind: "text" }]}
      onRemoveAttachment={onRemove} onChooseAttachments={() => {}} />);
    expect(screen.getByText("design.md")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove design.md" }));
    expect(onRemove).toHaveBeenCalledWith("att-1");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(onBeforeSend).toHaveBeenCalled());
    expect(onSend).not.toHaveBeenCalled();
  });

  it("accepts files pasted directly into the composer", () => {
    const onFiles = vi.fn();
    render(<ChatPanel events={[]} running={false} onSend={() => {}} onStop={() => {}} onFiles={onFiles} />);
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    fireEvent.paste(screen.getByLabelText("Message"), { clipboardData: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it("compacts consecutive tool calls and results into a closed disclosure", () => {
    render(<ChatPanel events={[
      { id: "call", taskId: "t", seq: 0, at: "", kind: "tool_call", text: "Bash", data: { tool: "Bash", callId: "b1", input: { command: "pwd" } } },
      { id: "result", taskId: "t", seq: 1, at: "", kind: "tool_result", text: "/workspace", data: { tool: "Bash", callId: "b1", ok: true } },
    ]} running={false} onSend={() => {}} onStop={() => {}} />);
    const disclosure = screen.getByText("Tools").closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getAllByText("Bash")).toHaveLength(2);
    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("recalls prior prompts with arrow keys", () => {
    render(<ChatPanel events={[
      { id: "u1", taskId: "t", seq: 0, at: "", kind: "user", text: "first prompt" },
      { id: "u2", taskId: "t", seq: 1, at: "", kind: "user", text: "second prompt" },
    ]} running={false} onSend={() => {}} onStop={() => {}} />);
    const box = screen.getByLabelText("Message");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(box).toHaveValue("second prompt");
    fireEvent.keyDown(box, { key: "ArrowUp" });
    expect(box).toHaveValue("first prompt");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box).toHaveValue("second prompt");
  });

  it("branches from a prior prompt and restores it to the composer", async () => {
    const onRewind = vi.fn(async () => "edit this prompt");
    render(<ChatPanel events={[{ id: "u", taskId: "t", seq: 0, at: "", kind: "user", text: "edit this prompt" }]} running={false} onSend={() => {}} onStop={() => {}} onRewind={onRewind} />);
    fireEvent.click(screen.getByRole("button", { name: "Rewind to prompt: edit this prompt" }));
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue("edit this prompt"));
    expect(onRewind).toHaveBeenCalledWith(expect.objectContaining({ id: "u", seq: 0 }));
  });
});
