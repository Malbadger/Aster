import React from "react";
import type { LogPolicy } from "@law/contracts";

/**
 * Logging settings (SURF-D-013, REQ-D-038..040). Community logging is off by
 * default and user-controlled. When a managed policy is in force it is shown
 * with a persistent, non-alarming "Managed" indicator and the controls are
 * disabled — the user can inspect but not override (RULE-D-005).
 */
export interface LoggingSettingsProps {
  policy: LogPolicy;
  onSetMode: (mode: "off" | "user") => void;
}

export function LoggingSettings(props: LoggingSettingsProps): React.JSX.Element {
  const managed = props.policy.managed;
  return (
    <section aria-label="Logging settings" style={{ padding: 12, maxWidth: 560 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>Logging</h2>
        {managed && (
          <span aria-label="Managed logging in force" style={{ fontSize: 11, padding: "1px 8px", borderRadius: 10, border: "1px solid var(--law-color-border-strong)", color: "var(--law-color-text-muted)" }}>
            Managed
          </span>
        )}
      </header>
      <p style={{ color: "var(--law-color-text-muted)", fontSize: 13 }}>
        {managed
          ? "Your administrator requires logging. You can inspect the policy but not change it."
          : "Operational and audit logging is off by default. Credentials are never logged in any mode."}
      </p>

      <fieldset disabled={managed} style={{ border: "1px solid var(--law-color-border)", borderRadius: 6, padding: 10 }}>
        <legend style={{ fontSize: 12, color: "var(--law-color-text-muted)" }}>Mode</legend>
        <label style={{ display: "block", marginBottom: 4 }}>
          <input type="radio" name="logmode" checked={props.policy.mode === "off"} onChange={() => props.onSetMode("off")} /> Off
        </label>
        <label style={{ display: "block", marginBottom: 4 }}>
          <input type="radio" name="logmode" checked={props.policy.mode === "user"} onChange={() => props.onSetMode("user")} /> User-managed (local JSONL)
        </label>
        {managed && (
          <label style={{ display: "block" }}>
            <input type="radio" name="logmode" checked readOnly /> Managed (required)
          </label>
        )}
      </fieldset>

      <dl style={{ fontSize: 12, color: "var(--law-color-text-muted)" }}>
        <dt style={{ fontWeight: 600 }}>Retention</dt>
        <dd style={{ margin: "0 0 6px" }}>{props.policy.retentionDays} days</dd>
        <dt style={{ fontWeight: 600 }}>Destination</dt>
        <dd style={{ margin: 0 }}>{props.policy.destination}</dd>
      </dl>
    </section>
  );
}
