import React from "react";
import type { Panel } from "../layout/layout.js";

interface AppMenuBarProps {
  hasFile: boolean;
  dirty: boolean;
  onNewChat: () => void;
  onNewFile: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onTogglePanel: (panel: Panel) => void;
  onResetLayout: () => void;
  onOpenSettings: (tab: "appearance" | "providers" | "about") => void;
  onOpenTerminal: () => void;
}

function Menu({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return <details className="app-menu" onMouseLeave={(event) => event.currentTarget.removeAttribute("open")}><summary>{label}</summary><div className="menu-popover" role="menu">{children}</div></details>;
}
function Item({ children, shortcut, disabled, onClick }: { children: React.ReactNode; shortcut?: string; disabled?: boolean; onClick?: () => void }): React.JSX.Element {
  return <button type="button" role="menuitem" disabled={disabled} onClick={(event) => {
    onClick?.(); (event.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute("open");
  }}><span>{children}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>;
}

export function AppMenuBar(props: AppMenuBarProps): React.JSX.Element {
  return <nav className="menubar" aria-label="Application menu">
    <Menu label="File">
      <Item shortcut="Ctrl+N" onClick={props.onNewFile}>New File</Item><Item shortcut="Ctrl+Shift+N" onClick={props.onNewChat}>New Chat</Item>
      <span className="menu-separator" /><Item shortcut="Ctrl+O" onClick={props.onOpenFile}>Open File…</Item><Item onClick={props.onOpenFolder}>Open Folder…</Item>
      <span className="menu-separator" /><Item shortcut="Ctrl+S" disabled={!props.hasFile || !props.dirty} onClick={props.onSave}>Save</Item><Item shortcut="Ctrl+Shift+S" disabled={!props.hasFile} onClick={props.onSaveAs}>Save As…</Item>
    </Menu>
    <Menu label="View"><Item onClick={() => props.onTogglePanel("fileTree")}>Explorer</Item><Item onClick={() => props.onTogglePanel("taskHistory")}>Task History</Item><Item onClick={() => props.onTogglePanel("editor")}>Editor</Item><Item onClick={() => props.onTogglePanel("terminal")}>Terminal Panel</Item><Item onClick={() => props.onTogglePanel("problems")}>Problems</Item><Item onClick={() => props.onTogglePanel("output")}>Output</Item><span className="menu-separator" /><Item onClick={() => props.onOpenSettings("appearance")}>Color Theme…</Item><Item onClick={props.onResetLayout}>Reset Layout</Item></Menu>
    <Menu label="Terminal"><Item shortcut="Ctrl+`" onClick={() => props.onTogglePanel("terminal")}>Show Terminal</Item><Item onClick={props.onOpenTerminal}>Open External Terminal</Item></Menu>
    <Menu label="Providers"><Item onClick={() => props.onOpenSettings("providers")}>Connect and manage…</Item></Menu>
    <Menu label="Help"><Item onClick={() => props.onOpenSettings("about")}>About Aster</Item></Menu>
  </nav>;
}
