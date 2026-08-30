import React from "react";
import type { FileState, Hunk } from "@law/contracts";

/**
 * Editable diff view (SURF-D-005, REQ-D-028/029). File- and hunk-level accept /
 * reject; each hunk shows its provenance. A verification-staleness banner makes
 * a stale prior PASS visible (RULE-D-004). Status is text + shape, not color
 * alone. Monaco provides the rich inline diff in production; this renders the
 * structured hunks and controls.
 */
export interface DiffViewProps {
  path: string;
  state: FileState;
  hunks: Hunk[];
  onHunkDecision: (hunkId: string, status: "accepted" | "rejected") => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

const VERIF_LABEL: Record<FileState["verification"], string> = {
  pass: "Verified (current)",
  fail: "Checks failing",
  stale: "Verification stale — re-run checks",
  unverified: "Not verified",
};

export function DiffView(props: DiffViewProps): React.JSX.Element {
  return (
    <section aria-label={`Diff for ${props.path}`} style={{ padding: 8 }}>
      <header style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
        <strong style={{ fontFamily: "var(--law-font-mono, monospace)", fontSize: 12 }}>{props.path}</strong>
        <span aria-label={`Provenance: ${props.state.provenance}`} style={{ fontSize: 11, padding: "1px 6px", border: "1px solid var(--law-color-border-strong)", borderRadius: 4, color: "var(--law-color-text-muted)" }}>
          {props.state.provenance}
        </span>
        <span
          role="status"
          aria-label={`Verification: ${VERIF_LABEL[props.state.verification]}`}
          style={{ fontSize: 11, padding: "1px 6px", border: "1px solid var(--law-color-border-strong)", borderRadius: 4, color: props.state.verification === "pass" ? "var(--law-color-success)" : "var(--law-color-warn)" }}
        >
          {VERIF_LABEL[props.state.verification]}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button type="button" onClick={props.onAcceptAll} style={btn()}>Accept all</button>
          <button type="button" onClick={props.onRejectAll} style={btn()}>Reject all</button>
        </span>
      </header>

      {props.state.verification === "stale" && (
        <p role="alert" style={{ fontSize: 12, color: "var(--law-color-warn)", margin: "4px 0" }}>
          This file was edited since it last passed; prior verification no longer applies to the current content.
        </p>
      )}

      <ol aria-label="Hunks" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {props.hunks.map((h) => (
          <li key={h.hunkId} style={{ border: "1px solid var(--law-color-border)", borderRadius: 6, marginBottom: 8, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", background: "var(--law-color-bg-elevated)" }}>
              <span style={{ fontSize: 11, color: "var(--law-color-text-muted)" }}>@@ -{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@ · {h.provenance}</span>
              <span style={{ marginLeft: "auto", fontSize: 11 }}>{h.status}</span>
              <button type="button" aria-label={`Accept hunk ${h.hunkId}`} onClick={() => props.onHunkDecision(h.hunkId, "accepted")} style={btn()}>Accept</button>
              <button type="button" aria-label={`Reject hunk ${h.hunkId}`} onClick={() => props.onHunkDecision(h.hunkId, "rejected")} style={btn()}>Reject</button>
            </div>
            <pre style={{ margin: 0, padding: 8, fontSize: 12, overflowX: "auto" }}>
              {h.lines.map((line, i) => (
                <div key={i} style={{ color: line.startsWith("+") ? "var(--law-color-success)" : line.startsWith("-") ? "var(--law-color-danger)" : "var(--law-color-text)" }}>{line}</div>
              ))}
            </pre>
          </li>
        ))}
      </ol>
    </section>
  );
}

function btn(): React.CSSProperties {
  return { fontSize: 11, minHeight: 24, padding: "2px 8px", borderRadius: 4, border: "1px solid var(--law-color-border)", background: "transparent", color: "var(--law-color-text)", cursor: "pointer" };
}
