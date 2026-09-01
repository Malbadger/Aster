import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel.js";
import type { ChatEvent } from "@law/contracts";

const events: ChatEvent[] = [
  { id: "e1", taskId: "t", seq: 0, at: "", kind: "user", text: "read a.ts" },
  { id: "e2", taskId: "t", seq: 1, at: "", kind: "assistant", text: "I’ll inspect it." },
  { id: "e3", taskId: "t", seq: 2, at: "", kind: "tool_denied", text: "tool not allowed" },
];

describe("ChatPanel", () => {
  it("renders events chronologically with kind labels (no ribbon)", () => {
    render(<ChatPanel events={events} running={false} onSend={() => {}} onStop={() => {}} />);
    const items = screen.getByRole("list", { name: "Conversation" }).querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(screen.getByText("Denied")).toBeInTheDocument();
  });

  it("sends a message and clears the composer", () => {
    const onSend = vi.fn();
    render(<ChatPanel events={[]} running={false} onSend={onSend} onStop={() => {}} />);
    const box = screen.getByLabelText("Message");
    fireEvent.change(box, { target: { value: "do it" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith("do it");
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
    expect(screen.getByText("gpt-5.6-sol")).toHaveAttribute("title", "Provider: openai-codex");
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
});
