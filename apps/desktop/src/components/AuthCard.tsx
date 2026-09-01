import React from "react";
import type { AuthFlow } from "@law/contracts";

export interface AuthProvider { id: string; name: string; methods: Array<"oauth"|"api_key">; configured: boolean }
export function AuthCard(props: { providers: AuthProvider[]; flow?: AuthFlow; browserError?: string; onStart: (provider: string, type: "oauth"|"api_key") => void; onOpenUrl: (url: string) => void; onRespond: (value: string) => void; onCancel: () => void }): React.JSX.Element {
  const [answer, setAnswer] = React.useState("");
  if (!props.flow) return <section className="chat-action-card" aria-label="Connect provider"><header><strong>Connect a provider</strong><button onClick={props.onCancel}>×</button></header><p>Authentication is handled by Pi. Aster never stores or logs credentials.</p><div className="auth-provider-list">{props.providers.map((provider) => provider.methods.map((method) => <button key={`${provider.id}-${method}`} onClick={() => props.onStart(provider.id, method)}><strong>{provider.name}</strong><span>{method === "oauth" ? "Sign in with account" : "Use API key"}{provider.configured ? " · connected" : ""}</span></button>))}</div></section>;
  const prompt = props.flow.prompt;
  return <section className="chat-action-card" aria-label="Provider authentication"><header><strong>Connect {props.flow.provider}</strong><button onClick={props.onCancel}>Cancel</button></header>
    {props.flow.messages.map((message, index) => <div key={index} className="auth-message">{message.url || message.verificationUri ? <button type="button" className="auth-browser-link" onClick={() => props.onOpenUrl((message.url ?? message.verificationUri)!)}>{message.message ?? "Open authentication page"}</button> : <span>{message.message}</span>}{message.userCode && <code>{message.userCode}</code>}</div>)}
    {prompt && <form onSubmit={(event) => { event.preventDefault(); props.onRespond(answer); setAnswer(""); }}><label>{prompt.message}{prompt.type === "select" ? <select value={answer} onChange={(event) => setAnswer(event.target.value)}><option value="">Choose…</option>{prompt.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select> : <input autoFocus type={prompt.type === "secret" ? "password" : "text"} value={answer} placeholder={prompt.placeholder} onChange={(event) => setAnswer(event.target.value)} />}</label><button type="submit" disabled={!answer}>Continue</button></form>}
    {props.flow.status === "running" && <div className="processing"><span className="agent-current"><i/><i/><i/></span><span>Connecting…</span></div>}
    {props.flow.status === "completed" && <strong className="auth-success">Connected</strong>}{(props.flow.error || props.browserError) && <span className="auth-error">{props.flow.error ?? props.browserError}</span>}
  </section>;
}
