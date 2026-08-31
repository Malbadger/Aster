import React from "react";
import type { ProviderConnection } from "@law/contracts";
import { ProviderConnections, type AddConnectionForm } from "./ProviderConnections.js";

export type LawTheme = "graphite" | "light" | "midnight" | "high-contrast"
  | "dracula" | "one-dark-pro" | "monokai" | "solarized-dark" | "solarized-light"
  | "nord" | "gruvbox-dark" | "github-dark" | "github-light" | "tokyo-night"
  | "night-owl" | "catppuccin-mocha" | "synthwave-84" | "atom-one-light";
export type SettingsTab = "appearance" | "providers" | "general";
export type EditorEngine = "vscode-oss";

export interface SettingsPanelProps {
  tab: SettingsTab;
  theme: LawTheme;
  connections: ProviderConnection[];
  providerState: "empty" | "loading" | "error" | "ready";
  providerError?: string;
  onTab: (tab: SettingsTab) => void;
  onTheme: (theme: LawTheme) => void;
  editorEngine: EditorEngine;
  onEditorEngine: (engine: EditorEngine) => void;
  onClose: () => void;
  onAddConnection: (form: AddConnectionForm) => void;
  onRemoveConnection: (id: string) => void;
  onSetConnectionEnabled: (id: string, enabled: boolean) => void;
  onCheckConnection: (id: string) => void;
  onLoginProvider: (provider: string) => void;
}

const THEMES: Array<{ id: LawTheme; name: string; description: string; colors: string[] }> = [
  { id: "graphite", name: "LAW Graphite", description: "Charcoal, stone, and signal teal", colors: ["#17161a", "#26242b", "#4fb6a6"] },
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
      <header><div><span className="empty-kicker">LAW</span><h1>Settings</h1></div><button type="button" aria-label="Close settings" onClick={props.onClose}>×</button></header>
      <div className="settings-body">
        <nav aria-label="Settings sections">
          {(["appearance", "providers", "general"] as SettingsTab[]).map((tab) => <button key={tab} type="button" className={props.tab === tab ? "active" : ""} onClick={() => props.onTab(tab)}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</button>)}
        </nav>
        <main>
          {props.tab === "appearance" && <section><h2>Color theme</h2><p>Choose a workspace palette. The selection is stored only on this device.</p><div className="theme-grid">
            {THEMES.map((theme) => <button key={theme.id} type="button" className={props.theme === theme.id ? "theme-card selected" : "theme-card"} aria-pressed={props.theme === theme.id} onClick={() => props.onTheme(theme.id)}>
              <span className="theme-swatch">{theme.colors.map((color) => <i key={color} style={{ background: color }} />)}</span><strong>{theme.name}</strong><small>{theme.description}</small>
            </button>)}
          </div></section>}
          {props.tab === "providers" && <ProviderConnections connections={props.connections} state={props.providerState} errorMessage={props.providerError}
            onAdd={props.onAddConnection} onRemove={props.onRemoveConnection} onSetEnabled={props.onSetConnectionEnabled} onCheck={props.onCheckConnection} onLogin={props.onLoginProvider} />}
          {props.tab === "general" && <section><h2>General</h2><div className="settings-row"><div><strong>Code editor</strong><p>LAW uses the installed open-source VSCodium workbench for every file.</p></div><span>VSCodium</span></div><div className="settings-row"><div><strong>Restore workspace layout</strong><p>LAW remembers open sidebars and bottom panels on this device.</p></div><span>Enabled</span></div><div className="settings-row"><div><strong>Offline-first model discovery</strong><p>Local endpoints remain available without a network connection.</p></div><span>Enabled</span></div></section>}
        </main>
      </div>
    </section>
  </div>;
}
