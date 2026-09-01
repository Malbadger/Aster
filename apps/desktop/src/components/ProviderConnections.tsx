import React from "react";
import type { AuthMethod, ConnLocality, ProviderApi, ProviderConnection, ProviderEndpoint } from "@law/contracts";
import type { AuthProvider } from "./AuthCard.js";

export interface AddConnectionForm {
  provider: string;
  label: string;
  authMethod: AuthMethod;
  locality: ConnLocality;
  reference?: string;
  endpoint?: ProviderEndpoint;
}

export interface GeminiCliStatusView { installed: boolean; configured: boolean; version?: string; authType?: string }

export interface ProviderConnectionsProps {
  connections: ProviderConnection[];
  state: "empty" | "loading" | "error" | "ready";
  errorMessage?: string;
  onAdd: (form: AddConnectionForm) => void;
  onRemove: (connectionId: string) => void;
  onSetEnabled: (connectionId: string, enabled: boolean) => void;
  onCheck: (connectionId: string) => void;
  authProviders?: AuthProvider[];
  geminiCli?: GeminiCliStatusView;
  onAuthenticate?: (provider: string, method: "oauth" | "api_key") => void;
  onGeminiCliLogin?: () => void;
}

type EndpointDraft = {
  provider: string; label: string; baseUrl: string; api: ProviderApi; models: string;
  authMethod: AuthMethod; locality: ConnLocality; reference: string; authHeader: boolean;
  headerName: string; headerReference: string;
};

const EMPTY_ENDPOINT: EndpointDraft = {
  provider: "", label: "", baseUrl: "", api: "openai-completions", models: "",
  authMethod: "oauth-device", locality: "remote", reference: "", authHeader: true,
  headerName: "", headerReference: "",
};

const PROVIDER_PRESETS = [
  { id: "anthropic", name: "Claude", detail: "Anthropic account or API key", choices: [{ provider: "anthropic", method: "oauth" as const, label: "Sign in" }, { provider: "anthropic", method: "api_key" as const, label: "API key" }] },
  { id: "openai", name: "ChatGPT / OpenAI", detail: "ChatGPT account or OpenAI API key", choices: [{ provider: "openai-codex", method: "oauth" as const, label: "Sign in" }, { provider: "openai", method: "api_key" as const, label: "API key" }] },
  { id: "xai", name: "Grok / xAI", detail: "SuperGrok, X Premium, or xAI API key", choices: [{ provider: "xai", method: "oauth" as const, label: "Sign in" }, { provider: "xai", method: "api_key" as const, label: "API key" }] },
  { id: "github-copilot", name: "GitHub Copilot", detail: "GitHub account or Copilot token", choices: [{ provider: "github-copilot", method: "oauth" as const, label: "Sign in" }, { provider: "github-copilot", method: "api_key" as const, label: "Token" }] },
];

const STATUS_LABEL: Record<ProviderConnection["status"], string> = { available: "Available", absent: "Not available", unknown: "Not checked", error: "Error" };

export function ProviderConnections(props: ProviderConnectionsProps): React.JSX.Element {
  const [showCustom, setShowCustom] = React.useState(false);
  const [advanced, setAdvanced] = React.useState(false);
  const [draft, setDraft] = React.useState<EndpointDraft>(EMPTY_ENDPOINT);
  const needsRef = draft.authMethod === "env-var" || draft.authMethod === "external-command" || draft.authMethod === "enterprise-broker";

  const prefill = (next: Partial<EndpointDraft>) => { setDraft({ ...EMPTY_ENDPOINT, ...next }); setShowCustom(true); };
  const submit = () => {
    const models = draft.models.split(/[\n,]/).map((id) => id.trim()).filter(Boolean).map((id) => ({ id, name: id, reasoning: false, vision: false, contextWindow: 128_000, maxTokens: 16_384 }));
    const endpoint: ProviderEndpoint = {
      baseUrl: draft.baseUrl, api: draft.api, models, authHeader: draft.authHeader,
      headers: draft.headerName.trim() && draft.headerReference.trim() ? [{ name: draft.headerName.trim(), valueReference: draft.headerReference.trim() }] : [],
    };
    props.onAdd({ provider: draft.provider.trim(), label: draft.label.trim(), authMethod: draft.authMethod, locality: draft.locality, ...(needsRef ? { reference: draft.reference.trim() } : {}), endpoint });
  };

  return <section aria-label="Provider connections" className="provider-settings">
    <h1>Providers</h1>
    <p className="provider-intro">Connect an account, enter an API key through a provider-owned flow, or add any compatible local or enterprise endpoint. Secret values never enter chat history or Aster logs.</p>

    <div className="provider-presets" aria-label="Provider quick setup">
      {PROVIDER_PRESETS.map((preset) => <article key={preset.id}>
        <span><strong>{preset.name}</strong><small>{preset.detail}</small></span>
        <div className="provider-auth-actions">{preset.choices.map((choice) => {
          const available = props.authProviders?.find((provider) => provider.id === choice.provider)?.methods.includes(choice.method);
          return <button key={`${choice.provider}-${choice.method}`} type="button" disabled={!available} title={available ? undefined : "Not available in the installed Pi runtime"} onClick={() => props.onAuthenticate?.(choice.provider, choice.method)}>{choice.label}</button>;
        })}</div>
      </article>)}
      <article>
        <span><strong>Gemini</strong><small>{props.geminiCli?.configured ? `Google account connected${props.geminiCli.version ? ` · CLI ${props.geminiCli.version}` : ""}` : "Google account or Gemini API key"}</small></span>
        <div className="provider-auth-actions">
          <button type="button" disabled={!props.geminiCli?.installed} onClick={props.onGeminiCliLogin}>{props.geminiCli?.configured ? "Reconnect" : "Sign in"}</button>
          <button type="button" disabled={!props.authProviders?.find((provider) => provider.id === "google")?.methods.includes("api_key")} onClick={() => props.onAuthenticate?.("google", "api_key")}>API key</button>
        </div>
      </article>
      <article>
        <span><strong>Perplexity</strong><small>OpenAI-compatible API</small></span>
        <button type="button" onClick={() => prefill({ provider: "perplexity", label: "Perplexity", baseUrl: "https://api.perplexity.ai", api: "openai-completions", locality: "remote" })}>Configure</button>
      </article>
      <article>
        <span><strong>Ollama</strong><small>Discovered automatically on this device</small></span>
        <button type="button" onClick={() => prefill({ provider: "local-api", label: "Local API", baseUrl: "http://127.0.0.1:11434/v1", api: "openai-completions", authMethod: "none-local", locality: "local", authHeader: false })}>Add endpoint</button>
      </article>
      <article className="provider-custom-launch">
        <span><strong>Another service</strong><small>Local server, proxy, or enterprise gateway</small></span>
        <button type="button" onClick={() => prefill({})}>Add provider</button>
      </article>
    </div>

    {props.state === "loading" && <p className="provider-state">Loading…</p>}
    {props.state === "error" && <p role="alert" className="provider-error">{props.errorMessage ?? "Could not load connections."}</p>}
    {props.connections.length > 0 && <ul role="list" aria-label="Connections" className="connection-list">{props.connections.map((connection) => <li key={connection.connectionId}>
      <span><strong>{connection.label}</strong><small>{connection.provider} · {connection.locality} · {connection.endpoint?.api ?? connection.authMethod}{connection.endpoint ? ` · ${connection.endpoint.models.length} model${connection.endpoint.models.length === 1 ? "" : "s"}` : ""}{connection.referenceHint ? ` · ref: ${connection.referenceHint}` : ""}</small></span>
      <em data-status={connection.status} aria-label={`Status: ${STATUS_LABEL[connection.status]}`}>{STATUS_LABEL[connection.status]}</em>
      <button type="button" onClick={() => props.onCheck(connection.connectionId)}>Check</button>
      <button type="button" aria-pressed={connection.enabled} onClick={() => props.onSetEnabled(connection.connectionId, !connection.enabled)}>{connection.enabled ? "Disable" : "Enable"}</button>
      <button type="button" aria-label={`Remove ${connection.label}`} onClick={() => props.onRemove(connection.connectionId)}>Remove</button>
    </li>)}</ul>}

    {showCustom && <div className="endpoint-builder">
      <header><div><span className="empty-kicker">Custom endpoint</span><h2>Add a model service</h2></div><button type="button" onClick={() => setShowCustom(false)}>Close</button></header>
      <p>Use a stable provider ID. Add one or more exact model IDs advertised by your service.</p>
      <div className="endpoint-grid">
        <label>Provider ID<input aria-label="Provider ID" placeholder="acme-ai" value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, "-") })} /></label>
        <label>Display name<input aria-label="Display name" placeholder="Acme AI" value={draft.label} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
        <label className="endpoint-wide">API URL<input aria-label="API URL" type="url" placeholder="https://api.example.com/v1" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
        <label>Protocol<select aria-label="Protocol" value={draft.api} onChange={(event) => {
          const api = event.target.value as ProviderApi;
          setDraft({ ...draft, api, authHeader: api === "openai-completions" || api === "openai-responses" });
        }}><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option><option value="google-generative-ai">Google Generative AI</option></select></label>
        <label>Location<select aria-label="Location" value={draft.locality} onChange={(event) => setDraft({ ...draft, locality: event.target.value as ConnLocality })}><option value="local">This device / local network</option><option value="remote">Remote / enterprise</option></select></label>
        <label className="endpoint-wide">Model IDs<textarea aria-label="Model IDs" rows={2} placeholder="model-a, model-b" value={draft.models} onChange={(event) => setDraft({ ...draft, models: event.target.value })} /></label>
        <label>Credentials<select aria-label="Credentials" value={draft.authMethod} onChange={(event) => setDraft({ ...draft, authMethod: event.target.value as AuthMethod })}><option value="oauth-device">Enter API key securely</option><option value="env-var">Environment variable</option><option value="external-command">Secret command</option><option value="none-local">No credentials</option></select></label>
        {needsRef ? <label>Credential reference<input aria-label="Credential reference" placeholder={draft.authMethod === "env-var" ? "ACME_API_KEY" : "secret-tool lookup…"} value={draft.reference} onChange={(event) => setDraft({ ...draft, reference: event.target.value })} /></label> : <span />}
      </div>
      <button className="endpoint-advanced-toggle" type="button" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>{advanced ? "Hide advanced options" : "Advanced headers"}</button>
      {advanced && <div className="endpoint-grid endpoint-advanced">
        <label>Header name<input aria-label="Header name" placeholder="x-api-key" value={draft.headerName} onChange={(event) => setDraft({ ...draft, headerName: event.target.value })} /></label>
        <label>Header value reference<input aria-label="Header value reference" placeholder="ACME_HEADER_VALUE" value={draft.headerReference} onChange={(event) => setDraft({ ...draft, headerReference: event.target.value })} /></label>
        <label className="endpoint-check"><input type="checkbox" checked={draft.authHeader} onChange={(event) => setDraft({ ...draft, authHeader: event.target.checked })} /> Send API key as Authorization: Bearer</label>
      </div>}
      <footer><button type="button" onClick={() => setShowCustom(false)}>Cancel</button><button className="primary" type="button" disabled={!draft.provider || !draft.label || !draft.baseUrl || !draft.models.trim() || (needsRef && !draft.reference.trim())} onClick={submit}>Add provider</button></footer>
    </div>}
  </section>;
}
