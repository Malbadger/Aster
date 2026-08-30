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
}

function Menu({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return <details className="app-menu"><summary>{label}</summary><div className="menu-popover">{children}</div></details>;
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
    <Menu label="Edit"><Item disabled>Undo</Item><Item disabled>Redo</Item><span className="menu-separator" /><Item disabled>Find</Item></Menu>
    <Menu label="Selection"><Item disabled>Select All</Item><Item disabled>Expand Selection</Item></Menu>
    <Menu label="View"><Item onClick={() => props.onTogglePanel("fileTree")}>Explorer</Item><Item onClick={() => props.onTogglePanel("taskHistory")}>Task History</Item><Item onClick={() => props.onTogglePanel("editor")}>Editor</Item><span className="menu-separator" /><Item onClick={props.onResetLayout}>Reset Layout</Item></Menu>
    <Menu label="Go"><Item disabled>Go to File…</Item><Item disabled>Go to Symbol…</Item></Menu>
    <Menu label="Run"><Item onClick={() => props.onTogglePanel("problems")}>Run Checks</Item><Item disabled>Stop</Item></Menu>
    <Menu label="Terminal"><Item onClick={() => props.onTogglePanel("terminal")}>New Terminal</Item><Item onClick={() => props.onTogglePanel("output")}>Show Output</Item></Menu>
    <Menu label="Providers"><Item disabled>Manage Connections…</Item><Item disabled>Refresh Models</Item></Menu>
    <Menu label="Help"><Item disabled>Command Reference</Item><Item disabled>About LAW</Item></Menu>
  </nav>;
}
