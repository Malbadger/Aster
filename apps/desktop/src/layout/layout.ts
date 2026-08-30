/**
 * Workspace layout model (REQ-D-026, DEC-D-009). Chat, editor, file tree, task
 * history, terminal, problems, and output are independently collapsible. Task
 * history is a separate mode from the file tree. Layout presets and a keyboard
 * reset are provided. Pure and serializable so layouts persist and restore
 * without auto-resuming execution (REQ-D-005).
 */
export const PANELS = ["chat", "editor", "fileTree", "taskHistory", "terminal", "problems", "output"] as const;
export type Panel = (typeof PANELS)[number];

export type Layout = Record<Panel, boolean>;

export const PRESETS = ["Chat", "Editor", "Chat+Editor", "Editor+Terminal", "Full Workspace", "Focus Active Panel"] as const;
export type Preset = (typeof PRESETS)[number];

function only(...visible: Panel[]): Layout {
  const base = Object.fromEntries(PANELS.map((p) => [p, false])) as Layout;
  for (const p of visible) base[p] = true;
  return base;
}

export const DEFAULT_LAYOUT: Layout = only("chat", "editor", "fileTree");

export function applyPreset(name: Preset, activePanel: Panel = "chat"): Layout {
  switch (name) {
    case "Chat":
      return only("chat");
    case "Editor":
      return only("editor", "fileTree");
    case "Chat+Editor":
      return only("chat", "editor", "fileTree");
    case "Editor+Terminal":
      return only("editor", "fileTree", "terminal", "problems");
    case "Full Workspace":
      return only(...PANELS);
    case "Focus Active Panel":
      return only(activePanel);
  }
}

export function togglePanel(layout: Layout, panel: Panel): Layout {
  return { ...layout, [panel]: !layout[panel] };
}

export function resetLayout(): Layout {
  return { ...DEFAULT_LAYOUT };
}

export function visiblePanels(layout: Layout): Panel[] {
  return PANELS.filter((p) => layout[p]);
}
