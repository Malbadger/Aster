import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FlatModelSelector } from "./FlatModelSelector.js";
import type { ModelDescriptor } from "@law/contracts";

const models: ModelDescriptor[] = [
  { id: "ollama:llama3", displayName: "llama3", provider: "ollama", locality: "local", availability: "available", effort: { supported: ["low"] }, capabilities: { tools: false, vision: false } },
  { id: "acme:pro", displayName: "Pro", provider: "acme", locality: "remote", availability: "auth-needed", effort: { supported: ["high"] }, capabilities: { tools: true, vision: false } },
];

describe("FlatModelSelector", () => {
  it("renders one flat list with display names primary", () => {
    render(<FlatModelSelector models={models} favorites={[]} query="" onQueryChange={() => {}} onSelect={() => {}} onToggleFavorite={() => {}} />);
    const list = screen.getByRole("listbox", { name: "Models" });
    expect(list).toBeInTheDocument();
    expect(screen.getByText("llama3")).toBeInTheDocument();
    // Secondary metadata present but distinct from the primary name.
    expect(screen.getByText(/ollama · local · available/)).toBeInTheDocument();
  });

  it("selects a model on click", () => {
    const onSelect = vi.fn();
    render(<FlatModelSelector models={models} favorites={[]} query="" onQueryChange={() => {}} onSelect={onSelect} onToggleFavorite={() => {}} />);
    fireEvent.click(screen.getByText("llama3"));
    expect(onSelect).toHaveBeenCalledWith("ollama:llama3");
  });

  it("toggles favorite without selecting the row", () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    render(<FlatModelSelector models={models} favorites={[]} query="" onQueryChange={() => {}} onSelect={onSelect} onToggleFavorite={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Favorite llama3" }));
    expect(onToggle).toHaveBeenCalledWith("ollama:llama3", true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("forwards search input", () => {
    const onQuery = vi.fn();
    render(<FlatModelSelector models={models} favorites={[]} query="" onQueryChange={onQuery} onSelect={() => {}} onToggleFavorite={() => {}} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search models" }), { target: { value: "pro" } });
    expect(onQuery).toHaveBeenCalledWith("pro");
  });
});
