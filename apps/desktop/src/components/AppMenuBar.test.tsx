import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppMenuBar } from "./AppMenuBar.js";

function renderMenu(overrides: Partial<React.ComponentProps<typeof AppMenuBar>> = {}) {
  const props: React.ComponentProps<typeof AppMenuBar> = {
    hasFile: false, dirty: false, onNewChat: vi.fn(), onNewFile: vi.fn(), onOpenFile: vi.fn(),
    onOpenFolder: vi.fn(), onSave: vi.fn(), onSaveAs: vi.fn(), onTogglePanel: vi.fn(), onResetLayout: vi.fn(), ...overrides,
  };
  render(<AppMenuBar {...props} />); return props;
}

describe("AppMenuBar", () => {
  it("offers the expected desktop menus and creates files", () => {
    const props = renderMenu();
    expect(screen.getByText("View")).toBeInTheDocument();
    expect(screen.getByText("Terminal")).toBeInTheDocument();
    fireEvent.click(screen.getByText("File"));
    fireEvent.click(screen.getByRole("menuitem", { name: /New File/ }));
    expect(props.onNewFile).toHaveBeenCalled();
  });

  it("enables save only for a dirty open file", () => {
    renderMenu({ hasFile: true, dirty: true });
    fireEvent.click(screen.getByText("File"));
    expect(screen.getByRole("menuitem", { name: /^Save Ctrl/ })).toBeEnabled();
  });
});
