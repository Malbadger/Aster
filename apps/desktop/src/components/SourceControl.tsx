import React from "react";
import type { GitStatus, RemoteConfirmation, RemoteEffect } from "@law/contracts";

/**
 * Source control (SURF-D-009, REQ-D-034..036). Local branch/stage/commit are
 * direct. A remote effect opens a confirmation that names the EXACT repository,
 * remote, branch, and effect; nothing remote happens until it is confirmed
 * (RULE-D-007).
 */
export interface SourceControlProps {
  status: GitStatus;
  pendingConfirmation?: RemoteConfirmation;
  onStage: (paths: string[]) => void;
  onCommit: (message: string) => void;
  onRequestRemote: (effect: RemoteEffect) => void;
  onConfirmRemote: (confirmation: RemoteConfirmation) => void;
  onCancelRemote: () => void;
}

export function SourceControl(props: SourceControlProps): React.JSX.Element {
  const [message, setMessage] = React.useState("");
  const s = props.status;
  return (
    <section aria-label="Source control" style={{ padding: 10 }}>
      <header style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
        <strong>{s.branch}</strong>
        <span style={{ fontSize: 11, color: "var(--law-color-text-muted)" }}>↑{s.ahead} ↓{s.behind} · {s.clean ? "clean" : `${s.files.length} changed`}</span>
      </header>

      <ul role="list" aria-label="Changed files" style={{ listStyle: "none", margin: 0, padding: 0, marginBottom: 8 }}>
        {s.files.map((f) => (
          <li key={f.path} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, padding: "2px 0" }}>
            <span style={{ width: 74, color: f.state === "conflicted" ? "var(--law-color-danger)" : "var(--law-color-text-muted)" }}>{f.state}</span>
            <span style={{ fontFamily: "monospace" }}>{f.path}</span>
            <button type="button" onClick={() => props.onStage([f.path])} style={btn()}>Stage</button>
          </li>
        ))}
      </ul>

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input aria-label="Commit message" placeholder="Commit message" value={message} onChange={(e) => setMessage(e.target.value)} style={{ flex: 1, minHeight: 32, padding: "4px 8px", borderRadius: 5, border: "1px solid var(--law-color-border)", background: "var(--law-color-bg-input)", color: "var(--law-color-text)" }} />
        <button type="button" disabled={!message.trim()} onClick={() => props.onCommit(message.trim())} style={btn()}>Commit</button>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={() => props.onRequestRemote("push")} style={btn()}>Push…</button>
        <button type="button" onClick={() => props.onRequestRemote("force-push")} style={btn()}>Force push…</button>
      </div>

      {props.pendingConfirmation && (
        <div role="alertdialog" aria-label="Confirm remote action" style={{ marginTop: 10, padding: 10, border: "1px solid var(--law-color-warn)", borderRadius: 6 }}>
          <p style={{ margin: "0 0 8px", fontSize: 13 }}>
            This will <strong>{props.pendingConfirmation.effect}</strong> to{" "}
            <strong>{props.pendingConfirmation.remote}/{props.pendingConfirmation.branch}</strong> in{" "}
            <code>{props.pendingConfirmation.repository}</code>. Data leaves this machine.
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={() => props.onConfirmRemote(props.pendingConfirmation!)} style={{ ...btn(), borderColor: "var(--law-color-warn)", color: "var(--law-color-warn)" }}>Confirm {props.pendingConfirmation.effect}</button>
            <button type="button" onClick={props.onCancelRemote} style={btn()}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}

function btn(): React.CSSProperties {
  return { fontSize: 12, minHeight: 32, padding: "2px 10px", borderRadius: 5, border: "1px solid var(--law-color-border)", background: "transparent", color: "var(--law-color-text)", cursor: "pointer" };
}
