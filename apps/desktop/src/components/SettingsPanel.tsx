import React from "react";
import type { ProviderConnection } from "@law/contracts";
import { ProviderConnections, type AddConnectionForm } from "./ProviderConnections.js";

export type LawTheme = "graphite" | "light" | "midnight" | "high-contrast";
export type SettingsTab = "appearance" | "providers" | "general";

export interface SettingsPanelProps {
  tab: SettingsTab;
  theme: LawTheme;
  connections: ProviderConnection[];
  providerState: "empty" | "loading" | "error" | "ready";
  providerError?: string;
  onTab: (tab: SettingsTab) => void;
  onTheme: (theme: LawTheme) => void;
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
          {props.tab === "general" && <section><h2>General</h2><div className="settings-row"><div><strong>Restore workspace layout</strong><p>LAW remembers open sidebars and bottom panels on this device.</p></div><span>Enabled</span></div><div className="settings-row"><div><strong>Offline-first model discovery</strong><p>Local endpoints remain available without a network connection.</p></div><span>Enabled</span></div></section>}
        </main>
      </div>
    </section>
  </div>;
}
