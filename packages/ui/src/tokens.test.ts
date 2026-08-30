import { describe, expect, it } from "vitest";
import { contrastRatio, darkTheme, lightTheme, themeToCss } from "./index.js";

const themes = [darkTheme, lightTheme];

describe("design tokens — Concept B", () => {
  for (const theme of themes) {
    it(`${theme.name}: body text on panel meets WCAG AA 4.5:1`, () => {
      const ratio = contrastRatio(theme.color.text!, theme.color["bg-panel"]!);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme.name}: body text on app background meets WCAG AA 4.5:1`, () => {
      const ratio = contrastRatio(theme.color.text!, theme.color["bg-app"]!);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme.name}: muted text meets large-text/non-text 3:1`, () => {
      const ratio = contrastRatio(theme.color["text-muted"]!, theme.color["bg-panel"]!);
      expect(ratio).toBeGreaterThanOrEqual(3);
    });

    it(`${theme.name}: accent label on accent fill is legible (>= 4.5:1)`, () => {
      const ratio = contrastRatio(theme.color["on-accent"]!, theme.color.accent!);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme.name}: emits CSS custom properties`, () => {
      const css = themeToCss(theme, ":root");
      expect(css).toContain("--law-color-accent:");
      expect(css).toContain("--law-color-text:");
    });
  }
});
