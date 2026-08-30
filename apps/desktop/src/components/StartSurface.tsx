import React from "react";

/**
 * Home / Start surface (SURF-D-002, REQ-D-004, EXP-D-002). Six entry points,
 * none of which require defining a workflow first (DEC-D-008). Recents are
 * shown but never auto-resume execution (REQ-D-005). Emits intents; the daemon
 * performs the actual open/clone behind policy in later phases.
 */
export type StartAction =
  | "open-folder"
  | "clone-repository"
  | "new-workspace"
  | "open-recent"
  | "new-chat"
  | "open-file";

export interface RecentEntry {
  id: string;
  label: string;
  kind: "workspace" | "task";
}

export interface StartSurfaceProps {
  recents: RecentEntry[];
  state: "empty" | "loading" | "error" | "ready";
  errorMessage?: string;
  onAction: (action: StartAction) => void;
  onOpenRecent: (id: string) => void;
}

const ENTRIES: { action: StartAction; label: string; hint: string }[] = [
  { action: "open-folder", label: "Open Folder", hint: "Work in an existing directory" },
  { action: "clone-repository", label: "Clone Repository", hint: "Clone a Git repository" },
  { action: "new-workspace", label: "New Workspace", hint: "Start an empty workspace" },
  { action: "open-recent", label: "Open Recent", hint: "Reopen recent work" },
  { action: "new-chat", label: "New Chat", hint: "Chat without opening files" },
  { action: "open-file", label: "Open File", hint: "Open a single file" },
];

export function StartSurface(props: StartSurfaceProps): React.JSX.Element {
  return (
    <section aria-label="Start" style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 18, marginBottom: 4 }}>Start</h1>
      <p style={{ color: "var(--law-color-text-muted)", marginTop: 0 }}>
        Open code or begin a chat — no workflow setup required.
      </p>

      <div role="group" aria-label="Start actions" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        {ENTRIES.map((e) => (
          <button
            key={e.action}
            type="button"
            onClick={() => props.onAction(e.action)}
            style={{
              textAlign: "left",
              padding: "12px 14px",
              minHeight: 32,
              background: "var(--law-color-bg-panel)",
              border: "1px solid var(--law-color-border)",
              borderRadius: 6,
              color: "var(--law-color-text)",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 600 }}>{e.label}</div>
            <div style={{ fontSize: 12, color: "var(--law-color-text-muted)" }}>{e.hint}</div>
          </button>
        ))}
      </div>

      <h2 style={{ fontSize: 14, marginTop: 20 }}>Recent</h2>
      {props.state === "loading" && <p style={{ color: "var(--law-color-text-muted)" }}>Loading recent items…</p>}
      {props.state === "error" && (
        <p role="alert" style={{ color: "var(--law-color-danger)" }}>
          {props.errorMessage ?? "Could not read recent items."}
        </p>
      )}
      {props.state === "empty" && (
        <p style={{ color: "var(--law-color-text-muted)" }}>No recent workspaces or tasks yet.</p>
      )}
      {props.state === "ready" && (
        <ul role="list" aria-label="Recent items" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {props.recents.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => props.onOpenRecent(r.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 8px",
                  minHeight: 32,
                  background: "transparent",
                  border: "1px solid transparent",
                  borderRadius: 5,
                  color: "var(--law-color-text)",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontWeight: 500 }}>{r.label}</span>{" "}
                <span style={{ fontSize: 11, color: "var(--law-color-text-faint)" }}>({r.kind})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
