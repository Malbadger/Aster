import { describe, expect, it } from "vitest";
import { applyPreset, DEFAULT_LAYOUT, resetLayout, togglePanel, visiblePanels } from "./layout.js";

describe("workspace layout (REQ-D-026)", () => {
  it("toggles a panel independently", () => {
    const l = togglePanel(DEFAULT_LAYOUT, "terminal");
    expect(l.terminal).toBe(true);
    expect(l.chat).toBe(DEFAULT_LAYOUT.chat);
  });

  it("keeps task history separate from the file tree", () => {
    const l = applyPreset("Full Workspace");
    expect(l.fileTree).toBe(true);
    expect(l.taskHistory).toBe(true);
  });

  it("Focus Active Panel shows only the active panel", () => {
    expect(visiblePanels(applyPreset("Focus Active Panel", "terminal"))).toEqual(["terminal"]);
  });

  it("Chat preset shows only chat", () => {
    expect(visiblePanels(applyPreset("Chat"))).toEqual(["chat"]);
  });

  it("reset returns the default layout", () => {
    expect(resetLayout()).toEqual(DEFAULT_LAYOUT);
  });
});
