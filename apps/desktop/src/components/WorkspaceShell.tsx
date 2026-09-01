import React from "react";
import { type Layout, type Panel, type Preset } from "../layout/layout.js";

const PANE_SIZE_KEY = "law.desktop.panes.v1";
const DEFAULT_SIZES = { sidebar: 280, chatRatio: 0.42, bottom: 260 };
type PaneSizes = typeof DEFAULT_SIZES;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function loadPaneSizes(): PaneSizes {
  try {
    const saved = JSON.parse(localStorage.getItem(PANE_SIZE_KEY) ?? "null") as Partial<PaneSizes> | null;
    return saved ? { ...DEFAULT_SIZES, ...saved } : { ...DEFAULT_SIZES };
  } catch {
    return { ...DEFAULT_SIZES };
  }
}

export interface WorkspaceShellProps {
  layout: Layout;
  activePanel: Panel;
  slots: Partial<Record<Panel, React.ReactNode>>;
  onToggle: (panel: Panel) => void;
  onPreset: (preset: Preset) => void;
  onReset: () => void;
  onSettings?: () => void;
}

const RAIL: Array<{ panel: Panel; icon: "files" | "history" | "chat" | "code"; label: string }> = [
  { panel: "fileTree", icon: "files", label: "Explorer" },
  { panel: "taskHistory", icon: "history", label: "Task history" },
  { panel: "chat", icon: "chat", label: "Chat" },
  { panel: "editor", icon: "code", label: "Editor" },
];
const BOTTOM: Panel[] = ["terminal", "problems", "output"];
const LABEL: Record<Panel, string> = { chat: "Chat", editor: "Editor", fileTree: "Explorer", taskHistory: "Tasks", terminal: "Terminal", problems: "Problems", output: "Output" };

function RailIcon({ name }: { name: "files" | "history" | "chat" | "code" | "settings" }): React.JSX.Element {
  const paths = {
    files: <><path d="M4 3h6l2 2h8v15H4z" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    history: <><path d="M4 5v5h5" /><path d="M5.5 9a7 7 0 1 1 .5 7" /><path d="M12 8v5l3 2" /></>,
    chat: <><path d="M4 4h16v12H9l-5 4z" /><path d="M8 9h8M8 12h5" /></>,
    code: <><path d="m9 6-5 6 5 6M15 6l5 6-5 6M13 4l-2 16" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.7-.6-1.4.9-1.9-2.1-2.1-1.9.9-1.4-.6-.7-2H9l-.7 2-1.4.6-1.9-.9-2.1 2.1.9 1.9-.6 1.4-2 .7v3l2 .7.6 1.4-.9 1.9L5 21.6l1.9-.9 1.4.6.7 2h3l.7-2 1.4-.6 1.9.9 2.1-2.1-.9-1.9.6-1.4z" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

/** Desktop workbench: activity rail + optional sidebar + primary surface + dock. */
export function WorkspaceShell(props: WorkspaceShellProps): React.JSX.Element {
  const [sizes, setSizes] = React.useState<PaneSizes>(loadPaneSizes);
  const sidebarPanel = props.activePanel === "fileTree" || props.activePanel === "taskHistory" ? props.activePanel : undefined;
  const sidebarVisible = sidebarPanel ? props.layout[sidebarPanel] : false;
  const editorVisible = props.layout.editor && Boolean(props.slots.editor);
  const chatVisible = props.layout.chat || !editorVisible;
  const activeBottom = BOTTOM.find((panel) => props.layout[panel]);

  React.useEffect(() => { localStorage.setItem(PANE_SIZE_KEY, JSON.stringify(sizes)); }, [sizes]);

  function drag(event: React.PointerEvent<HTMLDivElement>, update: (x: number, y: number) => void): void {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("law-resizing");
    const move = (next: PointerEvent) => update(next.clientX, next.clientY);
    const finish = () => {
      document.body.classList.remove("law-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
    window.addEventListener("pointercancel", finish, { once: true });
  }

  return <div className="workbench">
    <nav className="activity-rail" aria-label="Primary navigation">
      {RAIL.map(({ panel, icon, label }) => <button key={panel} type="button" className={props.layout[panel] ? "rail-button active" : "rail-button"}
        aria-label={label} aria-pressed={props.layout[panel]} onClick={() => props.onToggle(panel)}>
        <RailIcon name={icon} /><small>{label}</small>
      </button>)}
      <span className="rail-spacer" />
      <button type="button" className="rail-button" aria-label="Settings" onClick={props.onSettings}><RailIcon name="settings" /><small>Settings</small></button>
    </nav>

    {sidebarVisible && sidebarPanel && <>
      <aside className="workbench-sidebar" aria-label={LABEL[sidebarPanel]} style={{ width: sizes.sidebar }}>
        <header><strong>{LABEL[sidebarPanel]}</strong><button type="button" aria-label={`Close ${LABEL[sidebarPanel]}`} onClick={() => props.onToggle(sidebarPanel)}>×</button></header>
        <div className="sidebar-content">{props.slots[sidebarPanel]}</div>
      </aside>
      <div className="pane-resizer vertical" role="separator" tabIndex={0} aria-label={`Resize ${LABEL[sidebarPanel]}`} aria-orientation="vertical" aria-valuemin={210} aria-valuemax={520} aria-valuenow={Math.round(sizes.sidebar)}
        onDoubleClick={() => setSizes((old) => ({ ...old, sidebar: DEFAULT_SIZES.sidebar }))}
        onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setSizes((old) => ({ ...old, sidebar: clamp(old.sidebar + (event.key === "ArrowRight" ? 16 : -16), 210, 520) })); } }}
        onPointerDown={(event) => { const startX = event.clientX; const start = sizes.sidebar; drag(event, (x) => setSizes((old) => ({ ...old, sidebar: clamp(start + x - startX, 210, 520) }))); }} />
    </>}

    <section className="workbench-center" aria-label="Workspace">
      <div className={editorVisible && chatVisible ? "primary-grid split" : "primary-grid"}>
        {chatVisible && <div className="primary-pane chat-pane" style={editorVisible ? { flexBasis: `${sizes.chatRatio * 100}%` } : undefined}>{props.slots.chat}</div>}
        {editorVisible && chatVisible && <div className="pane-resizer vertical center-resizer" role="separator" tabIndex={0} aria-label="Resize chat and editor" aria-orientation="vertical" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(sizes.chatRatio * 100)}
          onDoubleClick={() => setSizes((old) => ({ ...old, chatRatio: DEFAULT_SIZES.chatRatio }))}
          onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setSizes((old) => ({ ...old, chatRatio: clamp(old.chatRatio + (event.key === "ArrowRight" ? .03 : -.03), .2, .8) })); } }}
          onPointerDown={(event) => { const bounds = event.currentTarget.parentElement?.getBoundingClientRect(); if (!bounds) return; drag(event, (x) => setSizes((old) => ({ ...old, chatRatio: clamp((x - bounds.left) / bounds.width, .2, .8) }))); }} />}
        {editorVisible && <div className="primary-pane editor-pane">{props.slots.editor}</div>}
      </div>
      {activeBottom && <>
        <div className="pane-resizer horizontal" role="separator" tabIndex={0} aria-label={`Resize ${LABEL[activeBottom]}`} aria-orientation="horizontal" aria-valuemin={120} aria-valuemax={700} aria-valuenow={Math.round(sizes.bottom)}
          onDoubleClick={() => setSizes((old) => ({ ...old, bottom: DEFAULT_SIZES.bottom }))}
          onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); setSizes((old) => ({ ...old, bottom: clamp(old.bottom + (event.key === "ArrowUp" ? 20 : -20), 120, 700) })); } }}
          onPointerDown={(event) => { const startY = event.clientY; const start = sizes.bottom; drag(event, (_x, y) => setSizes((old) => ({ ...old, bottom: clamp(start + startY - y, 120, Math.max(160, window.innerHeight - 180)) }))); }} />
        <section className="bottom-dock" aria-label="Bottom panel" style={{ height: sizes.bottom }}>
          <header>{BOTTOM.map((panel) => <button key={panel} type="button" className={panel === activeBottom ? "active" : ""} onClick={() => props.onToggle(panel)}>{LABEL[panel]}</button>)}
            <span /><button type="button" aria-label="Close bottom panel" onClick={() => props.onToggle(activeBottom)}>×</button></header>
          <div className="bottom-content">{props.slots[activeBottom]}</div>
        </section>
      </>}
      <footer className="statusbar"><span>Aster</span><span>Local workspace</span><span>UTF-8</span><span>Ln 1, Col 1</span></footer>
    </section>
  </div>;
}
