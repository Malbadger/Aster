import React from 'react';
import { EmbeddedTerminal } from './EmbeddedTerminal.js';

export function GeminiCliLogin(props: { directory?: string; onDone: () => void; onCancel: () => void }): React.JSX.Element {
  return <section className="gemini-login-card" aria-label="Gemini CLI sign in">
    <header>
      <div><strong>Sign in to Gemini</strong><small>Official Google Gemini CLI</small></div>
      <button type="button" onClick={props.onCancel}>Cancel</button>
    </header>
    <p>Choose <strong>Sign in with Google</strong> below and finish authorization in your browser. Aster never reads or copies the resulting OAuth credentials.</p>
    <div className="gemini-login-terminal"><EmbeddedTerminal directory={props.directory} launch={{ program: 'gemini' }} /></div>
    <footer><button className="primary" type="button" onClick={props.onDone}>Done — refresh models</button></footer>
  </section>;
}

