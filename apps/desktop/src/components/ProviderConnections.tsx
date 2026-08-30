import React from "react";
import type { AuthMethod, ConnLocality, ProviderConnection } from "@law/contracts";

/**
 * Provider connections surface (SURF-D-010, REQ-D-010). Provider-neutral:
 * shows status and a NON-SECRET reference hint only — never a credential value.
 * Add uses an auth METHOD plus a non-secret reference; the daemon secret-scans
 * it and refuses anything that looks like a secret.
 */
export interface AddConnectionForm {
  provider: string;
  label: string;
  authMethod: AuthMethod;
  locality: ConnLocality;
  reference?: string;
}

export interface ProviderConnectionsProps {
  connections: ProviderConnection[];
  state: "empty" | "loading" | "error" | "ready";
  errorMessage?: string;
  onAdd: (form: AddConnectionForm) => void;
  onRemove: (connectionId: string) => void;
  onSetEnabled: (connectionId: string, enabled: boolean) => void;
  onCheck: (connectionId: string) => void;
}

const AUTH_METHODS: { value: AuthMethod; label: string }[] = [
  { value: "none-local", label: "Local (no credentials)" },
  { value: "env-var", label: "Environment variable" },
  { value: "external-command", label: "External command" },
  { value: "enterprise-broker", label: "Enterprise broker" },
  { value: "oauth-device", label: "Provider login (OAuth / device)" },
];

const STATUS_LABEL: Record<ProviderConnection["status"], string> = {
  available: "Available",
  absent: "Not available",
  unknown: "Not checked",
  error: "Error",
};

export function ProviderConnections(props: ProviderConnectionsProps): React.JSX.Element {
  const [form, setForm] = React.useState<AddConnectionForm>({
    provider: "",
    label: "",
    authMethod: "none-local",
    locality: "local",
    reference: "",
  });
  const needsRef = form.authMethod === "env-var" || form.authMethod === "external-command" || form.authMethod === "enterprise-broker";

  return (
    <section aria-label="Provider connections" style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 18 }}>Providers</h1>
      <p style={{ color: "var(--law-color-text-muted)", marginTop: 0 }}>
        Connections show status only. LAW never stores or displays credential values.
      </p>

      {props.state === "loading" && <p style={{ color: "var(--law-color-text-muted)" }}>Loading…</p>}
      {props.state === "error" && (
        <p role="alert" style={{ color: "var(--law-color-danger)" }}>{props.errorMessage ?? "Could not load connections."}</p>
      )}
      {props.state === "empty" && <p style={{ color: "var(--law-color-text-muted)" }}>No provider connections yet.</p>}

      {props.state === "ready" && (
        <ul role="list" aria-label="Connections" style={{ listStyle: "none", padding: 0, margin: "8px 0" }}>
          {props.connections.map((c) => (
            <li key={c.connectionId} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", border: "1px solid var(--law-color-border)", borderRadius: 6, marginBottom: 6, background: "var(--law-color-bg-panel)" }}>
              <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{c.label}</span>
                <span style={{ fontSize: 11, color: "var(--law-color-text-muted)" }}>
                  {c.provider} · {c.locality} · {c.authMethod}
                  {c.referenceHint ? ` · ref: ${c.referenceHint}` : ""}
                </span>
              </span>
              <span aria-label={`Status: ${STATUS_LABEL[c.status]}`} style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, border: "1px solid var(--law-color-border-strong)", color: c.status === "available" ? "var(--law-color-success)" : "var(--law-color-warn)" }}>
                {STATUS_LABEL[c.status]}
              </span>
              <button type="button" onClick={() => props.onCheck(c.connectionId)} style={btn()}>Check</button>
              <button type="button" aria-pressed={c.enabled} onClick={() => props.onSetEnabled(c.connectionId, !c.enabled)} style={btn()}>
                {c.enabled ? "Disable" : "Enable"}
              </button>
              <button type="button" aria-label={`Remove ${c.label}`} onClick={() => props.onRemove(c.connectionId)} style={btn()}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      <form
        aria-label="Add connection"
        onSubmit={(e) => {
          e.preventDefault();
          props.onAdd({ ...form, reference: needsRef ? form.reference : undefined });
        }}
        style={{ display: "grid", gap: 6, marginTop: 12, borderTop: "1px solid var(--law-color-border)", paddingTop: 12 }}
      >
        <input aria-label="Provider" placeholder="Provider (e.g. ollama)" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} style={field()} />
        <input aria-label="Label" placeholder="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} style={field()} />
        <select aria-label="Auth method" value={form.authMethod} onChange={(e) => setForm({ ...form, authMethod: e.target.value as AuthMethod })} style={field()}>
          {AUTH_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select aria-label="Locality" value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value as ConnLocality })} style={field()}>
          <option value="local">local</option>
          <option value="remote">remote</option>
        </select>
        {needsRef && (
          <input aria-label="Reference" placeholder="Env var NAME, command, or broker label (never a secret)" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} style={field()} />
        )}
        <button type="submit" style={{ ...btn(), background: "var(--law-color-accent)", color: "var(--law-color-on-accent)", borderColor: "var(--law-color-accent)" }}>Add connection</button>
      </form>
    </section>
  );
}

function btn(): React.CSSProperties {
  return { minHeight: 32, padding: "4px 10px", borderRadius: 5, border: "1px solid var(--law-color-border)", background: "transparent", color: "var(--law-color-text)", cursor: "pointer", fontSize: 12 };
}
function field(): React.CSSProperties {
  return { minHeight: 32, padding: "6px 8px", borderRadius: 5, border: "1px solid var(--law-color-border)", background: "var(--law-color-bg-input)", color: "var(--law-color-text)" };
}
