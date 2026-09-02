import React from "react";
import type { WorkspaceEntry } from "@law/contracts";

export interface FileExplorerProps {
  root: string;
  activeFile?: string;
  listDirectory(path: string): Promise<WorkspaceEntry[]>;
  onOpenFile(path: string): void;
}

export function FileExplorer(props: FileExplorerProps): React.JSX.Element {
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set([props.root]));
  const [children, setChildren] = React.useState<Record<string, WorkspaceEntry[]>>({});
  const [loading, setLoading] = React.useState<Set<string>>(() => new Set());
  const [error, setError] = React.useState<string>();

  const load = React.useCallback(async (path: string) => {
    setLoading((current) => new Set(current).add(path));
    setError(undefined);
    try {
      const entries = await props.listDirectory(path);
      setChildren((current) => ({ ...current, [path]: entries }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading((current) => { const next = new Set(current); next.delete(path); return next; });
    }
  }, [props.listDirectory]);

  React.useEffect(() => {
    setExpanded(new Set([props.root]));
    setChildren({});
    void load(props.root);
  }, [props.root, load]);

  async function toggle(path: string): Promise<void> {
    if (expanded.has(path)) {
      setExpanded((current) => { const next = new Set(current); next.delete(path); return next; });
      return;
    }
    setExpanded((current) => new Set(current).add(path));
    if (!children[path]) await load(path);
  }

  function branch(path: string, depth: number): React.ReactNode {
    if (!expanded.has(path)) return null;
    const entries = children[path];
    if (!entries && loading.has(path)) return <li className="explorer-note" style={{ paddingLeft: 12 + depth * 14 }}>Loading…</li>;
    if (!entries?.length) return <li className="explorer-note" style={{ paddingLeft: 12 + depth * 14 }}>Empty folder</li>;
    return entries.map((entry) => <React.Fragment key={entry.path}>
      <li>
        <button type="button" className={`explorer-row ${entry.path === props.activeFile ? "active" : ""} ${entry.kind}`}
          style={{ paddingLeft: 8 + depth * 14 }} title={entry.path}
          aria-expanded={entry.kind === "directory" ? expanded.has(entry.path) : undefined}
          onClick={() => entry.kind === "directory" ? void toggle(entry.path) : entry.kind === "file" ? props.onOpenFile(entry.path) : undefined}>
          <span className="explorer-chevron" aria-hidden>{entry.kind === "directory" ? (expanded.has(entry.path) ? "⌄" : "›") : ""}</span>
          <span className="explorer-kind" aria-hidden>{entry.kind === "directory" ? "▱" : entry.kind === "symlink" ? "↗" : "·"}</span>
          <span>{entry.name}</span>
        </button>
      </li>
      {entry.kind === "directory" && branch(entry.path, depth + 1)}
    </React.Fragment>);
  }

  const rootName = props.root.split("/").filter(Boolean).at(-1) ?? props.root;
  return <div className="file-explorer">
    <div className="explorer-root" title={props.root}><span>Workspace</span><strong>{rootName}</strong></div>
    {error && <div className="explorer-error" role="alert">{error}</div>}
    <ul className="explorer-tree" aria-label={`${rootName} files`}>{branch(props.root, 0)}</ul>
  </div>;
}
