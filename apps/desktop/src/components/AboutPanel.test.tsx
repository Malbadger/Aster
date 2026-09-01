import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AboutPanel, type AboutInfo } from "./AboutPanel.js";
import { applyTheme, nextChoice, type Root } from "../theme/theme.js";

const about: AboutInfo = {
  name: "Aster",
  version: "0.1.0-desktop.dev",
  limitations: ["Windows/macOS deferred"],
  humanOnlyGates: ["release signing"],
};

describe("theme controller (REQ-D-044)", () => {
  it("applies and clears data-theme for system/light/dark", () => {
    const set: [string, string][] = [];
    const removed: string[] = [];
    const root: Root = { setAttribute: (n, v) => set.push([n, v]), removeAttribute: (n) => removed.push(n) };
    applyTheme(root, "dark");
    expect(set).toContainEqual(["data-theme", "dark"]);
    applyTheme(root, "system");
    expect(removed).toContain("data-theme");
  });

  it("cycles system -> light -> dark -> system", () => {
    expect(nextChoice("system")).toBe("light");
    expect(nextChoice("light")).toBe("dark");
    expect(nextChoice("dark")).toBe("system");
  });
});

describe("AboutPanel (REQ-D-045)", () => {
  it("shows version, limitations, and human-only gates", () => {
    render(<AboutPanel about={about} themeChoice="system" onThemeChange={() => {}} />);
    expect(screen.getByText(/0.1.0-desktop.dev/)).toBeInTheDocument();
    expect(screen.getByLabelText("Limitations")).toHaveTextContent("Windows/macOS deferred");
    expect(screen.getByLabelText("Human-only gates")).toHaveTextContent("release signing");
  });

  it("toggles the theme choice", () => {
    const onChange = vi.fn();
    render(<AboutPanel about={about} themeChoice="system" onThemeChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Theme: system/ }));
    expect(onChange).toHaveBeenCalledWith("light");
  });
});
