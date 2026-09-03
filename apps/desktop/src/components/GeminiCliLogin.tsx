import React from 'react';
import { EmbeddedTerminal } from './EmbeddedTerminal.js';

export function GeminiCliLogin(props: { directory?: string; onDone: () => void; onCancel: () => void }): React.JSX.Element {
  return <section className="gemini-login-card" aria-label="Google Cloud OAuth sign in">
    <header>
      <div><strong>Google Cloud OAuth</strong><small>Application Default Credentials for the official Antigravity SDK</small></div>
      <button type="button" onClick={props.onCancel}>Cancel</button>
    </header>
    <p>Finish Google’s browser-backed ADC sign-in below. Aster never reads or copies the resulting OAuth credential. Your Google Cloud project and location must also be configured for Vertex Standard mode.</p>
    <div className="gemini-login-terminal"><EmbeddedTerminal directory={props.directory} launch={{ program: 'gcloud-adc' }} /></div>
    <footer><button className="primary" type="button" onClick={props.onDone}>Done — refresh models</button></footer>
  </section>;
}
