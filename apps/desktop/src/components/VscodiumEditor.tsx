import React from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LawTheme } from "./SettingsPanel.js";

export function VscodiumEditor({ directory, file, theme }: { directory?: string; file?: string; theme: LawTheme }): React.JSX.Element {
  const [url, setUrl] = React.useState<string>();
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    let active = true;
    setError(undefined);
    void invoke<string>("vscodium_start", { directory, filePath: file, theme }).then((value) => {
      if (active) setUrl(value);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [directory, file, theme]);

  if (error) return <div className="empty-panel" role="alert"><strong>VSCodium could not start</strong><p>{error}</p></div>;
  if (!url) return <div className="vscodium-loading"><span className="agent-current" aria-hidden><i /><i /><i /></span><span>Starting VSCodium…</span></div>;
  return <iframe className="vscodium-frame" title="VSCodium editor" src={url} allow="clipboard-read; clipboard-write" />;
}
