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
  onOpenSettings: (tab: "appearance" | "providers" | "general") => void;
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
    <Menu label="Edit"><Item shortcut="Ctrl+Z" disabled>Undo</Item><Item shortcut="Ctrl+Shift+Z" disabled>Redo</Item><span className="menu-separator" /><Item shortcut="Ctrl+X" disabled>Cut</Item><Item shortcut="Ctrl+C" disabled>Copy</Item><Item shortcut="Ctrl+V" disabled>Paste</Item><span className="menu-separator" /><Item shortcut="Ctrl+F" disabled>Find</Item><Item shortcut="Ctrl+H" disabled>Replace</Item></Menu>
    <Menu label="Selection"><Item shortcut="Ctrl+A" disabled>Select All</Item><Item shortcut="Shift+Alt+→" disabled>Expand Selection</Item><Item shortcut="Shift+Alt+←" disabled>Shrink Selection</Item><Item shortcut="Ctrl+Alt+↓" disabled>Add Cursor Below</Item><Item disabled>Column Selection Mode</Item></Menu>
    <Menu label="View"><Item onClick={() => props.onTogglePanel("fileTree")}>Explorer</Item><Item onClick={() => props.onTogglePanel("taskHistory")}>Task History</Item><Item onClick={() => props.onTogglePanel("editor")}>Editor</Item><Item onClick={() => props.onTogglePanel("terminal")}>Terminal Panel</Item><Item onClick={() => props.onTogglePanel("problems")}>Problems</Item><Item onClick={() => props.onTogglePanel("output")}>Output</Item><span className="menu-separator" /><Item onClick={() => props.onOpenSettings("appearance")}>Color Theme…</Item><Item onClick={props.onResetLayout}>Reset Layout</Item></Menu>
    <Menu label="Go"><Item shortcut="Ctrl+P" disabled>Go to File…</Item><Item shortcut="Ctrl+Shift+O" disabled>Go to Symbol…</Item><Item shortcut="Ctrl+G" disabled>Go to Line…</Item><span className="menu-separator" /><Item shortcut="Alt+←" disabled>Back</Item><Item shortcut="Alt+→" disabled>Forward</Item></Menu>
    <Menu label="Run"><Item onClick={() => props.onTogglePanel("problems")}>Run Checks</Item><Item onClick={() => props.onTogglePanel("output")}>Show Run Output</Item><Item disabled>Run Active File</Item><Item disabled>Run Task…</Item><span className="menu-separator" /><Item disabled>Stop Active Run</Item></Menu>
    <Menu label="Terminal"><Item shortcut="Ctrl+`" onClick={props.onOpenTerminal}>New System Terminal</Item><Item onClick={() => props.onTogglePanel("terminal")}>Show Terminal Panel</Item><Item disabled>Split Terminal</Item><Item disabled>Clear Terminal</Item><Item disabled>Kill Active Terminal</Item></Menu>
    <Menu label="Providers"><Item onClick={() => props.onOpenSettings("providers")}>Manage Connections…</Item><Item onClick={() => props.onOpenSettings("providers")}>Connect Claude…</Item><Item onClick={() => props.onOpenSettings("providers")}>Connect ChatGPT…</Item><Item onClick={() => props.onOpenSettings("providers")}>Connect Gemini…</Item><span className="menu-separator" /><Item disabled>Refresh Model Catalog</Item></Menu>
    <Menu label="Help"><Item disabled>Command Reference</Item><Item disabled>Keyboard Shortcuts</Item><Item disabled>Documentation</Item><Item disabled>Report an Issue</Item><span className="menu-separator" /><Item onClick={() => props.onOpenSettings("general")}>About LAW</Item></Menu>
  </nav>;
}
