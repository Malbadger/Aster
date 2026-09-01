import React from "react";
import { EmbeddedTerminal } from "./EmbeddedTerminal.js";

export function ClaudeCodeLogin(props: { directory?: string; onDone: () => void; onCancel: () => void }): React.JSX.Element {
  return <section className="gemini-login-card" aria-label="Claude Code sign in">
    <header>
      <div><strong>Sign in to Claude Code</strong><small>Official Anthropic CLI</small></div>
      <button type="button" onClick={props.onCancel}>Cancel</button>
    </header>
    <p>Complete Anthropic's sign-in below. Claude Code owns the session and credentials; Aster only receives its structured chat responses.</p>
    <div className="gemini-login-terminal"><EmbeddedTerminal directory={props.directory} launch={{ program: "claude" }} /></div>
    <footer><button className="primary" type="button" onClick={props.onDone}>Done — return to chat</button></footer>
  </section>;
}
