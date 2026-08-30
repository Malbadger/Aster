import React from "react";
import { applyTheme, nextChoice, type ThemeChoice } from "../theme/theme.js";

/**
 * About / limitations / diagnostics (SURF-D-013, REQ-D-045). Reports product
 * identity, version, honest limitations, and the human-only gates. Includes the
 * theme toggle (system/light/dark). No missing capability is ever shown as ready.
 */
export interface AboutInfo {
  name: string;
  version: string;
  limitations: string[];
  humanOnlyGates: string[];
}

export interface AboutPanelProps {
  about: AboutInfo;
  themeChoice: ThemeChoice;
  onThemeChange: (choice: ThemeChoice) => void;
}

export function AboutPanel(props: AboutPanelProps): React.JSX.Element {
  return (
    <section aria-label="About LAW" style={{ padding: 16, maxWidth: 640 }}>
      <h1 style={{ fontSize: 18, margin: "0 0 2px" }}>{props.about.name}</h1>
      <p style={{ margin: "0 0 12px", color: "var(--law-color-text-muted)" }}>Version {props.about.version}</p>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 13 }}>Theme:</span>
        <button
          type="button"
          aria-label={`Theme: ${props.themeChoice}. Activate to change.`}
          onClick={() => props.onThemeChange(nextChoice(props.themeChoice))}
          style={{ minHeight: 32, padding: "4px 12px", borderRadius: 5, border: "1px solid var(--law-color-border)", background: "var(--law-color-bg-input)", color: "var(--law-color-text)", cursor: "pointer", textTransform: "capitalize" }}
        >
          {props.themeChoice}
        </button>
      </div>

      <h2 style={{ fontSize: 14 }}>Known limitations</h2>
      <ul aria-label="Limitations" style={{ margin: "0 0 12px", paddingLeft: 18, color: "var(--law-color-text-muted)", fontSize: 13 }}>
        {props.about.limitations.map((l) => <li key={l}>{l}</li>)}
      </ul>

      <h2 style={{ fontSize: 14 }}>Human-only decisions</h2>
      <ul aria-label="Human-only gates" style={{ margin: 0, paddingLeft: 18, color: "var(--law-color-text-muted)", fontSize: 13 }}>
        {props.about.humanOnlyGates.map((g) => <li key={g}>{g}</li>)}
      </ul>
    </section>
  );
}

/** Convenience: apply a theme choice to the live document root. */
export function useApplyTheme(choice: ThemeChoice): void {
  React.useEffect(() => {
    if (typeof document !== "undefined") applyTheme(document.documentElement, choice);
  }, [choice]);
}
