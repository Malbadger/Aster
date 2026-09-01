import React from "react";
import type { Task } from "@law/contracts";

/**
 * Task history (SURF-D-008, REQ-D-033). A durable, searchable list of tasks,
 * SEPARATE from the file tree. Open / resume / delete, with deletion scope
 * disclosed by the confirmation in App. Status is shown as text, not color alone.
 */
export interface TaskHistoryProps {
  tasks: Task[];
  state: "empty" | "loading" | "error" | "ready";
  query: string;
  onQueryChange: (q: string) => void;
  onOpen: (taskId: string) => void;
  onDelete: (taskId: string) => void;
}

export function TaskHistory(props: TaskHistoryProps): React.JSX.Element {
  return (
    <section aria-label="Task history" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: 8 }}>
        <input type="search" aria-label="Search tasks" placeholder="Search tasks…" value={props.query} onChange={(e) => props.onQueryChange(e.target.value)} style={{ width: "100%", minHeight: 32, padding: "6px 8px", borderRadius: 5, border: "1px solid var(--law-color-border)", background: "var(--law-color-bg-input)", color: "var(--law-color-text)" }} />
      </div>
      {props.state === "empty" && <p style={{ padding: 12, color: "var(--law-color-text-muted)" }}>No tasks yet. Start one in chat.</p>}
      {props.state === "loading" && <p style={{ padding: 12, color: "var(--law-color-text-muted)" }}>Loading…</p>}
      {props.state === "error" && <p role="alert" style={{ padding: 12, color: "var(--law-color-danger)" }}>Could not read task history (local store).</p>}
      {props.state === "ready" && (
        <ul role="list" aria-label="Tasks" style={{ listStyle: "none", margin: 0, padding: 0, overflowY: "auto" }}>
          {props.tasks.map((t) => (
            <li key={t.taskId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: "1px solid var(--law-color-border)" }}>
              <button type="button" onClick={() => props.onOpen(t.taskId)} style={{ flex: 1, textAlign: "left", background: "transparent", border: "none", color: "var(--law-color-text)", cursor: "pointer" }}>
                <span style={{ fontWeight: 600 }}>{t.title}</span>{" "}
                <span style={{ fontSize: 11, color: "var(--law-color-text-faint)" }}>({t.status})</span>
              </button>
              <button type="button" aria-label={`Delete ${t.title}`} onClick={() => props.onDelete(t.taskId)} style={btn()}>Delete</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function btn(): React.CSSProperties {
  return { fontSize: 11, minHeight: 28, padding: "2px 8px", borderRadius: 4, border: "1px solid var(--law-color-border)", background: "transparent", color: "var(--law-color-text)", cursor: "pointer" };
}
