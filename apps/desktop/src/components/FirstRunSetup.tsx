import React from "react";
import type { CapabilityProbe, CapabilityReport } from "@law/contracts";

/**
 * First-run setup (SURF-D-001, REQ-D-002/003, EXP-D-001). Shows each probed
 * capability with a distinct state (ready/missing/incompatible/unavailable) and
 * a recovery hint. Optional capabilities are labeled as such. Status is text +
 * a labeled badge, never color alone. Nothing is downloaded or installed here;
 * the surface only reports and offers to continue or skip optional items.
 */
export interface FirstRunSetupProps {
  probe: CapabilityProbe;
  onContinue: () => void;
  onRetry: () => void;
}

const STATE_LABEL: Record<CapabilityReport["state"], string> = {
  ready: "Ready",
  missing: "Missing",
  incompatible: "Incompatible",
  unavailable: "Unavailable",
};

function canContinue(probe: CapabilityProbe): boolean {
  // Required (non-optional) capabilities must be ready to continue.
  return probe.capabilities.filter((c) => !c.optional).every((c) => c.state === "ready");
}

export function FirstRunSetup(props: FirstRunSetupProps): React.JSX.Element {
  const ready = canContinue(props.probe);
  return (
    <section aria-label="First-run setup" style={{ maxWidth: 640, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 18 }}>Set up LAW</h1>
      <p style={{ color: "var(--law-color-text-muted)", marginTop: 0 }}>
        LAW checked your machine. Nothing was installed or downloaded.
      </p>
      <ul role="list" aria-label="Detected capabilities" style={{ listStyle: "none", padding: 0, margin: "12px 0" }}>
        {props.probe.capabilities.map((c) => (
          <li
            key={c.id}
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              padding: "10px 12px",
              border: "1px solid var(--law-color-border)",
              borderRadius: 6,
              marginBottom: 6,
              background: "var(--law-color-bg-panel)",
            }}
          >
            <span
              aria-hidden
              style={{
                marginTop: 2,
                fontSize: 11,
                padding: "1px 6px",
                borderRadius: 4,
                border: "1px solid var(--law-color-border-strong)",
                color: c.state === "ready" ? "var(--law-color-success)" : "var(--law-color-warn)",
                whiteSpace: "nowrap",
              }}
            >
              {STATE_LABEL[c.state]}
            </span>
            <span style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontWeight: 600 }}>
                {c.displayName}
                <span style={{ fontWeight: 400, color: "var(--law-color-text-faint)" }}>
                  {" "}
                  — {STATE_LABEL[c.state]}
                  {c.optional ? " · optional" : " · required"}
                  {c.detectedVersion ? ` · ${c.detectedVersion}` : ""}
                </span>
              </span>
              <span style={{ fontSize: 12, color: "var(--law-color-text-muted)" }}>{c.detail}</span>
              {c.recovery && (
                <span style={{ fontSize: 12, color: "var(--law-color-warn)" }}>Next: {c.recovery}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={props.onContinue}
          disabled={!ready}
          aria-disabled={!ready}
          style={{
            minHeight: 32,
            padding: "6px 14px",
            borderRadius: 5,
            border: "1px solid var(--law-color-accent)",
            background: ready ? "var(--law-color-accent)" : "var(--law-color-bg-input)",
            color: ready ? "var(--law-color-on-accent)" : "var(--law-color-text-faint)",
            cursor: ready ? "pointer" : "not-allowed",
          }}
        >
          Continue
        </button>
        <button
          type="button"
          onClick={props.onRetry}
          style={{
            minHeight: 32,
            padding: "6px 14px",
            borderRadius: 5,
            border: "1px solid var(--law-color-border)",
            background: "transparent",
            color: "var(--law-color-text)",
            cursor: "pointer",
          }}
        >
          Re-check
        </button>
      </div>
      {!ready && (
        <p role="status" style={{ fontSize: 12, color: "var(--law-color-text-muted)" }}>
          A required capability is not ready yet. Resolve it, then re-check.
        </p>
      )}
    </section>
  );
}
