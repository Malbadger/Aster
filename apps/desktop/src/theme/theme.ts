/**
 * Theme controller (BUILD-D-020, REQ-D-044). Three states — system / light /
 * dark — applied via `data-theme` on the document root, matching the token CSS.
 * Status is never color-only elsewhere; this only selects the palette. Reduced
 * motion is honored by CSS (`prefers-reduced-motion`).
 */
export type ThemeChoice = "system" | "light" | "dark";

export interface Root {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export function applyTheme(root: Root, choice: ThemeChoice): void {
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

/** Next choice in a system -> light -> dark -> system cycle. */
export function nextChoice(choice: ThemeChoice): ThemeChoice {
  return choice === "system" ? "light" : choice === "light" ? "dark" : "system";
}
