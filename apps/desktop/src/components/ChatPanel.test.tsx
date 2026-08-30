import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel.js";
import type { ChatEvent } from "@law/contracts";

const events: ChatEvent[] = [
  { id: "e1", taskId: "t", seq: 0, at: "", kind: "user", text: "read a.ts" },
  { id: "e2", taskId: "t", seq: 1, at: "", kind: "plan", text: "Interpreted as a natural-language request." },
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
  });
});
