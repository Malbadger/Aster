import React from "react";
import { type Layout, type Panel, type Preset } from "../layout/layout.js";

export interface WorkspaceShellProps {
  layout: Layout;
  activePanel: Panel;
  slots: Partial<Record<Panel, React.ReactNode>>;
  onToggle: (panel: Panel) => void;
  onPreset: (preset: Preset) => void;
  onReset: () => void;
}

const RAIL: Array<{ panel: Panel; glyph: string; label: string }> = [
  { panel: "fileTree", glyph: "◇", label: "Explorer" },
  { panel: "taskHistory", glyph: "◷", label: "Task history" },
  { panel: "chat", glyph: "◌", label: "Chat" },
  { panel: "editor", glyph: "⌘", label: "Editor" },
];
const BOTTOM: Panel[] = ["terminal", "problems", "output"];
const LABEL: Record<Panel, string> = { chat: "Chat", editor: "Editor", fileTree: "Explorer", taskHistory: "Tasks", terminal: "Terminal", problems: "Problems", output: "Output" };

/** Desktop workbench: activity rail + optional sidebar + primary surface + dock. */
export function WorkspaceShell(props: WorkspaceShellProps): React.JSX.Element {
  const sidebarPanel = props.activePanel === "fileTree" || props.activePanel === "taskHistory" ? props.activePanel : undefined;
  const sidebarVisible = sidebarPanel ? props.layout[sidebarPanel] : false;
  const editorVisible = props.layout.editor && Boolean(props.slots.editor);
  const chatVisible = props.layout.chat || !editorVisible;
  const activeBottom = BOTTOM.find((panel) => props.layout[panel]);

  return <div className="workbench">
    <nav className="activity-rail" aria-label="Primary navigation">
      {RAIL.map(({ panel, glyph, label }) => <button key={panel} type="button" className={props.layout[panel] ? "rail-button active" : "rail-button"}
        aria-label={label} aria-pressed={props.layout[panel]} onClick={() => props.onToggle(panel)}>
        <span aria-hidden>{glyph}</span><small>{label}</small>
      </button>)}
      <span className="rail-spacer" />
      <button type="button" className="rail-button" aria-label="Settings"><span aria-hidden>⚙</span><small>Settings</small></button>
    </nav>

    {sidebarVisible && sidebarPanel && <aside className="workbench-sidebar" aria-label={LABEL[sidebarPanel]}>
      <header><strong>{LABEL[sidebarPanel]}</strong><button type="button" aria-label={`Close ${LABEL[sidebarPanel]}`} onClick={() => props.onToggle(sidebarPanel)}>×</button></header>
      <div className="sidebar-content">{props.slots[sidebarPanel]}</div>
    </aside>}

    <section className="workbench-center" aria-label="Workspace">
      <div className={editorVisible && chatVisible ? "primary-grid split" : "primary-grid"}>
        {chatVisible && <div className="primary-pane chat-pane">{props.slots.chat}</div>}
        {editorVisible && <div className="primary-pane editor-pane">{props.slots.editor}</div>}
      </div>
      {activeBottom && <section className="bottom-dock" aria-label="Bottom panel">
        <header>{BOTTOM.map((panel) => <button key={panel} type="button" className={panel === activeBottom ? "active" : ""} onClick={() => props.onToggle(panel)}>{LABEL[panel]}</button>)}
          <span /><button type="button" aria-label="Close bottom panel" onClick={() => props.onToggle(activeBottom)}>×</button></header>
        <div className="bottom-content">{props.slots[activeBottom]}</div>
      </section>}
      <footer className="statusbar"><span>LAW</span><span>Local workspace</span><span>UTF-8</span><span>Ln 1, Col 1</span></footer>
    </section>
  </div>;
}
