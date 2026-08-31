import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AuthCard } from "./AuthCard.js";
import type { AuthFlow } from "@law/contracts";

const flow: AuthFlow = {
  flowId: "auth-1",
  provider: "openai-codex",
  authType: "oauth",
  status: "waiting",
  messages: [{ type: "auth_url", url: "https://example.test/oauth", message: "Open browser" }],
  prompt: { type: "text", message: "Paste callback", placeholder: "http://localhost/callback" },
};

describe("AuthCard", () => {
  it("hands an OAuth URL to the native browser callback", () => {
    const onOpenUrl = vi.fn();
    render(<AuthCard providers={[]} flow={flow} onStart={() => {}} onOpenUrl={onOpenUrl} onRespond={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Open browser" }));
    expect(onOpenUrl).toHaveBeenCalledWith("https://example.test/oauth");
  });

  it("surfaces a native browser launch failure beside the login flow", () => {
    render(<AuthCard providers={[]} flow={flow} browserError="Browser did not open" onStart={() => {}} onOpenUrl={() => {}} onRespond={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Browser did not open")).toBeInTheDocument();
  });
});
