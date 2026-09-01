import React from 'react';
import { EmbeddedTerminal } from './EmbeddedTerminal.js';

export function GeminiCliLogin(props: { directory?: string; onDone: () => void; onCancel: () => void }): React.JSX.Element {
  return <section className="gemini-login-card" aria-label="Google Antigravity sign in">
    <header>
      <div><strong>Sign in to Google models</strong><small>Official Google Antigravity CLI</small></div>
      <button type="button" onClick={props.onCancel}>Cancel</button>
    </header>
    <p>Finish the Google sign-in shown below. Aster never reads or copies the resulting OAuth credentials. Gemini API-key and enterprise connections remain available separately.</p>
    <div className="gemini-login-terminal"><EmbeddedTerminal directory={props.directory} launch={{ program: 'antigravity' }} /></div>
    <footer><button className="primary" type="button" onClick={props.onDone}>Done — refresh models</button></footer>
  </section>;
}
