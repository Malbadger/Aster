import React from "react";
import { invoke } from "@tauri-apps/api/core";

export function VscodiumEditor({ directory }: { directory?: string }): React.JSX.Element {
  const [url, setUrl] = React.useState<string>();
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    let active = true;
    setError(undefined);
    void invoke<string>("vscodium_start", { directory }).then((value) => {
      if (active) setUrl(value);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [directory]);

  if (error) return <div className="empty-panel" role="alert"><strong>VSCodium could not start</strong><p>{error}</p></div>;
  if (!url) return <div className="vscodium-loading"><span className="agent-current" aria-hidden><i /><i /><i /></span><span>Starting VSCodium…</span></div>;
  return <iframe className="vscodium-frame" title="VSCodium editor" src={url} allow="clipboard-read; clipboard-write" />;
}
