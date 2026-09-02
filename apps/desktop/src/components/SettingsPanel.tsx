import React from "react";
import type { McpServerConfig, McpServerView, ModelDescriptor, ProviderConnection, UsageSummary } from "@law/contracts";
import { ProviderConnections, type AddConnectionForm, type GeminiCliStatusView } from "./ProviderConnections.js";
import type { AuthProvider } from "./AuthCard.js";
import { McpHub } from "./McpHub.js";

export type LawTheme = "graphite" | "light" | "midnight" | "high-contrast"
  | "dracula" | "one-dark-pro" | "monokai" | "solarized-dark" | "solarized-light"
  | "nord" | "gruvbox-dark" | "github-dark" | "github-light" | "tokyo-night"
  | "night-owl" | "catppuccin-mocha" | "synthwave-84" | "atom-one-light";
export type SettingsTab = "appearance" | "providers" | "models" | "mcp" | "usage" | "about";
export type EditorEngine = "vscode-oss";

export interface SettingsPanelProps {
  tab: SettingsTab;
  theme: LawTheme;
  connections: ProviderConnection[];
  providerState: "empty" | "loading" | "error" | "ready";
  providerError?: string;
  authProviders: AuthProvider[];
  geminiCli?: GeminiCliStatusView;
  usage?: UsageSummary;
  models: ModelDescriptor[];
  providerDefaults: Record<string, string>;
  mcpServers: McpServerView[];
  mcpConfigPath?: string;
  mcpBusyId?: string;
  mcpError?: string;
  onTab: (tab: SettingsTab) => void;
  onTheme: (theme: LawTheme) => void;
  editorEngine: EditorEngine;
  onEditorEngine: (engine: EditorEngine) => void;
  onClose: () => void;
  onAddConnection: (form: AddConnectionForm) => void;
  onRemoveConnection: (id: string) => void;
  onSetConnectionEnabled: (id: string, enabled: boolean) => void;
  onCheckConnection: (id: string) => void;
  onAuthenticate: (provider: string, method: "oauth" | "api_key") => void;
  onSetProviderDefault: (provider: string, modelId?: string) => void;
  onGeminiCliLogin?: () => void;
  onClaudeCodeLogin?: () => void;
  onMcpUpsert: (server: McpServerConfig) => void;
  onMcpImport: (json: string) => void;
  onMcpSetEnabled: (id: string, enabled: boolean) => void;
  onMcpTest: (id: string) => void;
  onMcpRemove: (id: string) => void;
}

const THEMES: Array<{ id: LawTheme; name: string; description: string; colors: string[] }> = [
  { id: "graphite", name: "Aster Graphite", description: "Charcoal, stone, and signal teal", colors: ["#17161a", "#26242b", "#4fb6a6"] },
  { id: "light", name: "Paper", description: "Low-glare light workspace", colors: ["#f6f4f1", "#ffffff", "#177567"] },
  { id: "midnight", name: "Midnight", description: "Blue-black with electric cyan", colors: ["#0b1020", "#121a2d", "#52c7ea"] },
  { id: "high-contrast", name: "High Contrast", description: "Maximum separation and focus", colors: ["#000000", "#111111", "#ffe36e"] },
  { id: "dracula", name: "Dracula", description: "Deep violet with vivid accents", colors: ["#282a36", "#21222c", "#bd93f9"] },
  { id: "one-dark-pro", name: "One Dark Pro", description: "Balanced charcoal and cool blue", colors: ["#282c34", "#21252b", "#61afef"] },
  { id: "monokai", name: "Monokai", description: "Classic dark with electric cyan", colors: ["#272822", "#1e1f1c", "#66d9ef"] },
  { id: "solarized-dark", name: "Solarized Dark", description: "Low-contrast blue-green workspace", colors: ["#002b36", "#00212b", "#268bd2"] },
  { id: "solarized-light", name: "Solarized Light", description: "Warm paper with blue accents", colors: ["#fdf6e3", "#eee8d5", "#268bd2"] },
  { id: "nord", name: "Nord", description: "Arctic blue-gray palette", colors: ["#2e3440", "#2b303b", "#88c0d0"] },
  { id: "gruvbox-dark", name: "Gruvbox Dark", description: "Warm retro earth tones", colors: ["#282828", "#1d2021", "#fabd2f"] },
  { id: "github-dark", name: "GitHub Dark", description: "Crisp neutral dark workspace", colors: ["#0d1117", "#010409", "#58a6ff"] },
  { id: "github-light", name: "GitHub Light", description: "Clean neutral light workspace", colors: ["#ffffff", "#f6f8fa", "#0969da"] },
  { id: "tokyo-night", name: "Tokyo Night", description: "Indigo night with cool blue", colors: ["#1a1b26", "#16161e", "#7aa2f7"] },
  { id: "night-owl", name: "Night Owl", description: "Deep navy designed for focus", colors: ["#011627", "#011221", "#82aaff"] },
  { id: "catppuccin-mocha", name: "Catppuccin Mocha", description: "Soft dark pastels", colors: ["#1e1e2e", "#181825", "#89b4fa"] },
  { id: "synthwave-84", name: "Synthwave 84", description: "Neon dusk with coral accents", colors: ["#262335", "#241b2f", "#f97e72"] },
  { id: "atom-one-light", name: "Atom One Light", description: "Soft gray light workspace", colors: ["#fafafa", "#eaeaeb", "#4078f2"] },
];

export function SettingsPanel(props: SettingsPanelProps): React.JSX.Element {
  return <div className="settings-layer" role="dialog" aria-modal="true" aria-label="Settings">
    <section className="settings-window">
      <header><div><span className="empty-kicker">Aster</span><h1>Settings</h1></div><button type="button" aria-label="Close settings" onClick={props.onClose}>×</button></header>
      <div className="settings-body">
        <nav aria-label="Settings sections">
          {(["appearance", "providers", "models", "mcp", "usage", "about"] as SettingsTab[]).map((tab) => <button key={tab} type="button" className={props.tab === tab ? "active" : ""} onClick={() => props.onTab(tab)}>{tab === "mcp" ? "MCP Hub" : tab.charAt(0).toUpperCase() + tab.slice(1)}</button>)}
        </nav>
        <main>
          {props.tab === "appearance" && <section><h2>Color theme</h2><p>Choose a workspace palette. Aster and its embedded VSCodium editor stay synchronized, and the selection is stored only on this device.</p><div className="theme-grid">
            {THEMES.map((theme) => <button key={theme.id} type="button" className={props.theme === theme.id ? "theme-card selected" : "theme-card"} aria-pressed={props.theme === theme.id} onClick={() => props.onTheme(theme.id)}>
              <span className="theme-swatch">{theme.colors.map((color) => <i key={color} style={{ background: color }} />)}</span><strong>{theme.name}</strong><small>{theme.description}</small>
            </button>)}
          </div></section>}
          {props.tab === "providers" && <ProviderConnections connections={props.connections} state={props.providerState} errorMessage={props.providerError}
            authProviders={props.authProviders} geminiCli={props.geminiCli} onAdd={props.onAddConnection} onRemove={props.onRemoveConnection} onSetEnabled={props.onSetConnectionEnabled} onCheck={props.onCheckConnection} onAuthenticate={props.onAuthenticate} onGeminiCliLogin={props.onGeminiCliLogin} onClaudeCodeLogin={props.onClaudeCodeLogin} />}
          {props.tab === "models" && <ProviderDefaults models={props.models} defaults={props.providerDefaults} onSet={props.onSetProviderDefault} />}
          {props.tab === "mcp" && <McpHub servers={props.mcpServers} configPath={props.mcpConfigPath} busyId={props.mcpBusyId} error={props.mcpError}
            onUpsert={props.onMcpUpsert} onImport={props.onMcpImport} onSetEnabled={props.onMcpSetEnabled} onTest={props.onMcpTest} onRemove={props.onMcpRemove} />}
          {props.tab === "usage" && <UsagePanel usage={props.usage} />}
          {props.tab === "about" && <section><h2>About Aster</h2><p>Local Agent Workbench is a provider-neutral desktop environment for Pi, local models, and connected model accounts.</p><div className="settings-row"><div><strong>Code editor</strong><p>Aster embeds the open-source VSCodium workbench and synchronizes its palette with the application.</p></div><span>VSCodium</span></div><div className="settings-row"><div><strong>Workspace layout</strong><p>Pane visibility and your resized dimensions are remembered only on this device.</p></div><span>Local</span></div><div className="settings-row"><div><strong>Offline operation</strong><p>Local Ollama models remain available without signing in to a remote provider.</p></div><span>Supported</span></div></section>}
        </main>
      </div>
    </section>
  </div>;
}

function ProviderDefaults({ models, defaults, onSet }: { models: ModelDescriptor[]; defaults: Record<string, string>; onSet: (provider: string, modelId?: string) => void }): React.JSX.Element {
  const providers = [...new Set(models.map((model) => model.provider))].sort();
  return <section className="provider-defaults"><h2>Default models</h2><p>Choose one exact default per provider. Orchestration uses it only when a provider is named without a model, and never substitutes another model.</p>
    {!providers.length ? <div className="settings-empty"><strong>No models discovered</strong><span>Connect a provider or start a local endpoint first.</span></div> : providers.map((provider) => {
      const candidates = models.filter((model) => model.provider === provider);
      const selected = defaults[provider] ?? "";
      const selectedModel = candidates.find((model) => model.id === selected);
      return <label className="settings-row provider-default-row" key={provider}>
        <div><strong>{providerName(provider)}</strong><p>{selectedModel ? `${selectedModel.displayName} · ${selectedModel.locality}` : "No default selected"}</p></div>
        <select aria-label={`${providerName(provider)} default model`} value={selected} onChange={(event) => onSet(provider, event.target.value || undefined)}>
          <option value="">No default</option>
          {candidates.map((model) => <option key={model.id} value={model.id} disabled={model.availability !== "available"}>{model.displayName}{model.availability === "available" ? "" : ` (${model.availability})`}</option>)}
        </select>
      </label>;
    })}
  </section>;
}

function UsagePanel({ usage }: { usage?: UsageSummary }): React.JSX.Element {
  return <section className="usage-panel"><h2>Token usage</h2><p>Tokens observed by Aster in locally retained chats. Provider plan limits are not estimated.</p>
    {usage?.measuredSince && <small className="usage-since">Measured since {new Date(usage.measuredSince).toLocaleDateString()}</small>}
    {!usage?.providers.length ? <div className="settings-empty"><strong>No measured usage yet</strong><span>Provider totals appear after a model reports token usage.</span></div> : <div className="usage-provider-list">{usage.providers.map((provider) => <article className="usage-provider" key={provider.provider}>
      <header><div><span>{providerName(provider.provider)}</span><strong>{formatTokens(provider.total)}</strong></div><small>{formatTokens(provider.input)} in · {formatTokens(provider.output)} out</small></header>
      <div>{provider.models.map((model) => <div className="usage-model" key={model.model}><span>{model.model}</span><b>{formatTokens(model.total)}</b><small>{formatTokens(model.input)} in · {formatTokens(model.output)} out</small></div>)}</div>
    </article>)}</div>}
  </section>;
}

function formatTokens(value: number): string {
  if (value < 1_000) return `${value} tokens`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}K tokens`;
  return `${(value / 1_000_000).toFixed(2)}M tokens`;
}

function providerName(provider: string): string {
  const known: Record<string, string> = { anthropic: "Claude Code", "openai-codex": "OpenAI", ollama: "Ollama", "ollama-local": "Ollama", "gemini-cli": "Gemini CLI", antigravity: "Antigravity" };
  return known[provider] ?? provider.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
