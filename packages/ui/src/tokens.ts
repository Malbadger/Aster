/**
 * Aster design tokens — revised Concept B (OPEN-D-001 provisional default).
 *
 * Direction (03-INTERACTION-DECISIONS): dark warm-charcoal studio, muted
 * teal/coral semantic accents, crisp typography, restrained rounding, compact
 * professional density. Light theme keeps semantic parity (LNX-LIGHT). Final
 * contrast conformance is verified in the accessibility battery (BUILD-D-020);
 * values here target 4.5:1 body text and 3:1 large-text / non-text boundaries.
 */

export interface ThemeTokens {
  readonly name: "dark" | "light";
  readonly color: Record<string, string>;
}

/** Warm-charcoal dark studio — the primary reference (LNX-1440). */
export const darkTheme: ThemeTokens = {
  name: "dark",
  color: {
    "bg-app": "#17161a",
    "bg-panel": "#1e1d22",
    "bg-elevated": "#26242b",
    "bg-input": "#211f26",
    border: "#38353f",
    "border-strong": "#4a4653",
    text: "#ece9f0",
    "text-muted": "#a8a3b3",
    "text-faint": "#7d7889",
    // Muted teal — primary semantic accent.
    accent: "#4fb6a6",
    "accent-strong": "#66cbba",
    "on-accent": "#0c1613",
    // Muted coral — attention/consequential semantic accent.
    warn: "#e08a72",
    "warn-strong": "#ef9d85",
    danger: "#e06c6c",
    success: "#6fbf8f",
    focus: "#8fd6ff",
  },
};

/** Light studio — semantic parity for LNX-LIGHT. */
export const lightTheme: ThemeTokens = {
  name: "light",
  color: {
    "bg-app": "#f6f4f1",
    "bg-panel": "#ffffff",
    "bg-elevated": "#ffffff",
    "bg-input": "#ffffff",
    border: "#ddd8d2",
    "border-strong": "#c3bdb5",
    text: "#211f26",
    "text-muted": "#5c5766",
    "text-faint": "#7d7889",
    accent: "#177567",
    "accent-strong": "#136a5c",
    "on-accent": "#ffffff",
    warn: "#b5502f",
    "warn-strong": "#993f22",
    danger: "#b3352f",
    success: "#2f7d4f",
    focus: "#0b6fb8",
  },
};

/** Non-color scales shared by both themes. */
export const scale = {
  radius: { sm: "3px", md: "5px", lg: "8px" },
  space: { xs: "4px", sm: "8px", md: "12px", lg: "16px", xl: "24px" },
  /** Interactive target minimums (03 Profiles): 24px compact, 32px general. */
  control: { compact: "24px", general: "32px" },
  font: {
    ui: '"Inter", "Segoe UI", system-ui, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
    sizeSm: "12px",
    sizeMd: "13px",
    sizeLg: "15px",
  },
} as const;

/** Emit a theme as CSS custom properties for a selector. */
export function themeToCss(theme: ThemeTokens, selector: string): string {
  const vars = Object.entries(theme.color)
    .map(([k, v]) => `  --law-color-${k}: ${v};`)
    .join("\n");
  return `${selector} {\n${vars}\n}`;
}
