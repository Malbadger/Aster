import React from "react";
import { PANELS, PRESETS, visiblePanels, type Layout, type Panel, type Preset } from "../layout/layout.js";

/**
 * Workspace shell (SURF-D-003, REQ-D-026). A slim activity rail toggles the
 * independently collapsible panels; a preset menu and reset are provided. No
 * fixed orchestration ribbon. Panel content is supplied via `slots`.
 */
export interface WorkspaceShellProps {
  layout: Layout;
  activePanel: Panel;
  slots: Partial<Record<Panel, React.ReactNode>>;
  onToggle: (panel: Panel) => void;
  onPreset: (preset: Preset) => void;
  onReset: () => void;
}

const PANEL_LABEL: Record<Panel, string> = {
  chat: "Chat",
  editor: "Editor",
  fileTree: "Files",
  taskHistory: "Tasks",
  terminal: "Terminal",
  problems: "Problems",
  output: "Output",
};

export function WorkspaceShell(props: WorkspaceShellProps): React.JSX.Element {
  const visible = visiblePanels(props.layout);
  return (
    <div style={{ display: "flex", height: "100%" }}>
      <nav aria-label="Panels" style={{ display: "flex", flexDirection: "column", gap: 2, padding: 6, borderRight: "1px solid var(--law-color-border)", background: "var(--law-color-bg-panel)" }}>
        {PANELS.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={props.layout[p]}
            aria-label={`Toggle ${PANEL_LABEL[p]}`}
            onClick={() => props.onToggle(p)}
            style={{ minHeight: 32, padding: "4px 8px", borderRadius: 5, fontSize: 11, cursor: "pointer", border: "1px solid transparent", color: props.layout[p] ? "var(--law-color-text)" : "var(--law-color-text-faint)", background: props.layout[p] ? "var(--law-color-bg-elevated)" : "transparent" }}
          >
            {PANEL_LABEL[p]}
          </button>
        ))}
      </nav>

      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
        <header style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 10px", borderBottom: "1px solid var(--law-color-border)" }}>
          <label style={{ fontSize: 12, color: "var(--law-color-text-muted)" }}>
            Layout{" "}
            <select aria-label="Layout preset" onChange={(e) => props.onPreset(e.target.value as Preset)} style={{ background: "var(--law-color-bg-input)", color: "var(--law-color-text)", border: "1px solid var(--law-color-border)", borderRadius: 4, padding: "2px 4px" }}>
              <option value="">Preset…</option>
              {PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <button type="button" onClick={props.onReset} style={{ fontSize: 12, minHeight: 32, padding: "2px 8px", borderRadius: 4, border: "1px solid var(--law-color-border)", background: "transparent", color: "var(--law-color-text)", cursor: "pointer" }}>Reset layout</button>
        </header>

        <div role="group" aria-label="Panels area" style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {visible.length === 0 && <p style={{ margin: "auto", color: "var(--law-color-text-muted)" }}>All panels collapsed. Toggle one from the rail.</p>}
          {visible.map((p) => (
            <section key={p} aria-label={PANEL_LABEL[p]} style={{ flex: 1, minWidth: 0, borderRight: "1px solid var(--law-color-border)", overflow: "auto" }}>
              {props.slots[p] ?? <div style={{ padding: 12, color: "var(--law-color-text-faint)" }}>{PANEL_LABEL[p]}</div>}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
