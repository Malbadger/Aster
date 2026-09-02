import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { McpHub } from "./McpHub.js";

describe("McpHub", () => {
  it("adds a local server and imports JSON without a CLI", () => {
    const onUpsert = vi.fn(); const onImport = vi.fn();
    render(<McpHub servers={[]} onUpsert={onUpsert} onImport={onImport} onSetEnabled={vi.fn()} onTest={vi.fn()} onRemove={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("ID"), { target: { value: "docs" } });
    fireEvent.change(screen.getByLabelText("Command"), { target: { value: "npx" } });
    fireEvent.change(screen.getByLabelText("Arguments"), { target: { value: '-y "docs server"' } });
    fireEvent.click(screen.getByRole("button", { name: "Add server" }));
    expect(onUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: "docs", command: "npx", args: ["-y", "docs server"] }));
    fireEvent.click(screen.getByRole("button", { name: "Import MCP JSON" }));
    fireEvent.click(screen.getByRole("button", { name: "Validate and import" }));
    expect(onImport).toHaveBeenCalledWith(expect.stringContaining("mcpServers"));
  });
});
