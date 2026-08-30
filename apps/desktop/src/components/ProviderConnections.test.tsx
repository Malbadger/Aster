import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
    // default authMethod is none-local -> no reference field
    expect(screen.queryByLabelText("Reference")).toBeNull();
    fireEvent.change(screen.getByLabelText("Auth method"), { target: { value: "env-var" } });
    expect(screen.getByLabelText("Reference")).toBeInTheDocument();
  });

  it("submits the add form and toggles enabled", () => {
    const onAdd = vi.fn();
    const onSetEnabled = vi.fn();
    render(<ProviderConnections connections={conns} state="ready" onAdd={onAdd} onRemove={noop} onSetEnabled={onSetEnabled} onCheck={noop} />);
    fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "ollama" } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "My Local" } });
    fireEvent.click(screen.getByRole("button", { name: "Add connection" }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ provider: "ollama", label: "My Local", authMethod: "none-local" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable" })); // c2 is disabled
    expect(onSetEnabled).toHaveBeenCalledWith("c2", true);
  });
});
