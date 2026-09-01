import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ProviderConnections } from "./ProviderConnections.js";
import type { ProviderConnection } from "@law/contracts";

const conns: ProviderConnection[] = [
  { connectionId: "c1", provider: "ollama", label: "Local", authMethod: "none-local", locality: "local", enabled: true, status: "available" },
  { connectionId: "c2", provider: "acme", label: "Acme", authMethod: "env-var", locality: "remote", enabled: false, status: "absent", referenceHint: "ACME_KEY" },
];

const noop = () => {};

describe("ProviderConnections", () => {
  it("shows status and non-secret reference hint, never a value", () => {
    render(<ProviderConnections connections={conns} state="ready" onAdd={noop} onRemove={noop} onSetEnabled={noop} onCheck={noop} />);
    expect(screen.getByText(/ref: ACME_KEY/)).toBeInTheDocument();
    expect(screen.getByLabelText("Status: Available")).toBeInTheDocument();
    expect(screen.getByLabelText("Status: Not available")).toBeInTheDocument();
  });

  it("shows a reference field only for reference-based auth methods", () => {
    render(<ProviderConnections connections={[]} state="empty" onAdd={noop} onRemove={noop} onSetEnabled={noop} onCheck={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
    expect(screen.queryByLabelText("Credential reference")).toBeNull();
    fireEvent.change(screen.getByLabelText("Credentials"), { target: { value: "env-var" } });
    expect(screen.getByLabelText("Credential reference")).toBeInTheDocument();
  });

  it("submits the add form and toggles enabled", () => {
    const onAdd = vi.fn();
    const onSetEnabled = vi.fn();
    render(<ProviderConnections connections={conns} state="ready" onAdd={onAdd} onRemove={noop} onSetEnabled={onSetEnabled} onCheck={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
    fireEvent.change(screen.getByLabelText("Provider ID"), { target: { value: "acme" } });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Acme Enterprise" } });
    fireEvent.change(screen.getByLabelText("API URL"), { target: { value: "https://llm.acme.example/v1" } });
    fireEvent.change(screen.getByLabelText("Model IDs"), { target: { value: "acme-code, acme-review" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add provider" }).at(-1)!);
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({
      provider: "acme", label: "Acme Enterprise", authMethod: "oauth-device",
      endpoint: expect.objectContaining({ baseUrl: "https://llm.acme.example/v1", api: "openai-completions", models: [expect.objectContaining({ id: "acme-code" }), expect.objectContaining({ id: "acme-review" })] }),
    }));
    fireEvent.click(screen.getByRole("button", { name: "Enable" })); // c2 is disabled
    expect(onSetEnabled).toHaveBeenCalledWith("c2", true);
  });

  it("starts supported account and API-key authentication inside the app", () => {
    const onAuthenticate = vi.fn();
    const onGeminiCliLogin = vi.fn();
    const onClaudeCodeLogin = vi.fn();
    render(<ProviderConnections connections={[]} state="empty" onAdd={noop} onRemove={noop} onSetEnabled={noop} onCheck={noop}
      geminiCli={{ installed: true, configured: false, version: "0.57.0", antigravityInstalled: true }}
      authProviders={[
        { id: "anthropic", name: "Anthropic", methods: ["oauth", "api_key"], configured: false },
        { id: "google", name: "Google", methods: ["api_key"], configured: false },
      ]} onAuthenticate={onAuthenticate} onGeminiCliLogin={onGeminiCliLogin} onClaudeCodeLogin={onClaudeCodeLogin} />);
    const claude = screen.getByText("Claude").closest("article")!;
    fireEvent.click(within(claude).getByRole("button", { name: "Claude Code sign in" }));
    expect(onClaudeCodeLogin).toHaveBeenCalledOnce();
    fireEvent.click(within(claude).getByRole("button", { name: "API key" }));
    expect(onAuthenticate).toHaveBeenCalledWith("anthropic", "api_key");
    const gemini = screen.getByText("Gemini").closest("article")!;
    fireEvent.click(within(gemini).getByRole("button", { name: "Sign in" }));
    expect(onGeminiCliLogin).toHaveBeenCalledOnce();
    fireEvent.click(within(gemini).getByRole("button", { name: "API key" }));
    expect(onAuthenticate).toHaveBeenCalledWith("google", "api_key");
  });

  it("prefills a compatible service and adapts API-key headers to its protocol", () => {
    render(<ProviderConnections connections={[]} state="empty" onAdd={noop} onRemove={noop} onSetEnabled={noop} onCheck={noop} />);
    const perplexity = screen.getByText("Perplexity").closest("article")!;
    fireEvent.click(within(perplexity).getByRole("button", { name: "Configure" }));
    expect(screen.getByLabelText("Provider ID")).toHaveValue("perplexity");
    expect(screen.getByLabelText("API URL")).toHaveValue("https://api.perplexity.ai");
    expect(screen.getByLabelText("Protocol")).toHaveValue("openai-completions");
    fireEvent.click(screen.getByRole("button", { name: "Advanced headers" }));
    expect(screen.getByRole("checkbox")).toBeChecked();
    fireEvent.change(screen.getByLabelText("Protocol"), { target: { value: "anthropic-messages" } });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });
});
