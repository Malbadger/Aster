import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

interface TerminalOutput { sessionId: string; data: string }

export type TerminalProgram = "pi" | "gemini" | "antigravity" | "claude";

export function EmbeddedTerminal({ directory, launch }: { directory?: string; launch?: { program: TerminalProgram; initialInput?: string } }): React.JSX.Element {
  const host = React.useRef<HTMLDivElement>(null);
  const [failure, setFailure] = React.useState<string>();

  React.useEffect(() => {
    if (!host.current) return;
    let disposed = false;
    let sessionId: string | undefined;
    let terminal: XtermTerminal | undefined;
    let unlisten: (() => void) | undefined;
    let disconnect: (() => void) | undefined;

    void (async () => {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
        if (disposed || !host.current) return;
        terminal = new Terminal({
          cursorBlink: true, convertEol: true, fontFamily: '"IBM Plex Mono", "DejaVu Sans Mono", monospace',
          fontSize: 12, lineHeight: 1.25, scrollback: 5000,
          theme: { background: "#111015", foreground: "#ece9f0", cursor: "#66cbba", selectionBackground: "#4fb6a655" },
        });
        const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(host.current);
        unlisten = await listen<TerminalOutput>("terminal-output", ({ payload }) => {
          if (payload.sessionId === sessionId) terminal?.write(payload.data);
        });
        const resize = new ResizeObserver(() => {
          fit.fit();
          if (sessionId && terminal) void invoke("terminal_resize", { sessionId, cols: terminal.cols, rows: terminal.rows });
        });
        resize.observe(host.current);
        const dataSubscription = terminal.onData((data) => { if (sessionId) void invoke("terminal_write", { sessionId, data }); });
        disconnect = () => { resize.disconnect(); dataSubscription.dispose(); };
        fit.fit();
        sessionId = await invoke<string>("terminal_start", { directory, cols: terminal.cols, rows: terminal.rows, program: launch?.program });
        if (disposed) { await invoke("terminal_stop", { sessionId }); return; }
        if (launch?.initialInput) await invoke("terminal_write", { sessionId, data: launch.initialInput });
        terminal.focus();
      } catch (cause) {
        if (!disposed) setFailure(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      disposed = true; disconnect?.(); unlisten?.();
      if (sessionId) void invoke("terminal_stop", { sessionId });
      terminal?.dispose();
    };
  }, [directory, launch?.program, launch?.initialInput]);

  return <section className="embedded-terminal" aria-label="Terminal session">
    {failure && <div className="terminal-error" role="alert">Terminal could not start: {failure}</div>}
    <div ref={host} className="terminal-canvas" />
  </section>;
}
