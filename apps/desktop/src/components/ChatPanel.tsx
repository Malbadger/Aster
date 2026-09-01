import React from "react";
import type { ChatEvent } from "@law/contracts";

/**
 * Chat panel (SURF-D-004, EXP-D-004/005). Orchestration is chat-native: plans,
 * tool calls, denials, handoffs, and results are ordinary chronological cards —
 * there is no permanent orchestration ribbon. The composer carries the flat
 * model selector + effort control (passed as `controls`) next to send/stop.
 */
export interface ChatPanelProps {
  events: ChatEvent[];
  running: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onRespondApproval?: (approvalId: string, approved: boolean) => void;
  controls?: React.ReactNode;
  interactive?: React.ReactNode;
}

const KIND_LABEL: Partial<Record<ChatEvent["kind"], string>> = {
  plan: "Thinking",
  tool_call: "Tool",
  tool_result: "Result",
  tool_denied: "Denied",
  handoff: "Handoff",
  approval: "Approval",
  status: "Status",
  error: "Error",
};

function eventColor(kind: ChatEvent["kind"]): string {
  if (kind === "error" || kind === "tool_denied") return "var(--law-color-danger)";
  if (kind === "user") return "var(--law-color-accent-strong)";
  return "var(--law-color-text-muted)";
}

function eventIdentity(event: ChatEvent, phases: Map<string, { provider: string; model: string }>): { provider: string; model: string } | undefined {
  const direct = event.data?.identity;
  if (direct && typeof direct === "object" && "provider" in direct && "model" in direct
    && typeof direct.provider === "string" && typeof direct.model === "string") {
    return { provider: direct.provider, model: direct.model };
  }
  return event.phaseId ? phases.get(event.phaseId) : undefined;
}

export function ChatPanel(props: ChatPanelProps): React.JSX.Element {
  const [text, setText] = React.useState("");
  const phaseIdentities = new Map<string, { provider: string; model: string }>();
  for (const event of props.events) {
    if (!event.phaseId) continue;
    const identity = eventIdentity(event, phaseIdentities);
    if (identity) phaseIdentities.set(event.phaseId, identity);
  }
  const conversationalEvents = props.events.filter((event) => event.kind !== "status");
  const visibleEvents = conversationalEvents.filter((event, index) => {
    if (event.kind !== "assistant" || index === 0) return true;
    const previous = conversationalEvents[index - 1];
    return !(previous?.kind === "user" && Boolean(event.text) && previous.text?.trim() === event.text?.trim());
  });
  const resolvedApprovals = new Set(props.events.filter((event) => event.kind === "status" && typeof event.data?.approvalId === "string").map((event) => String(event.data?.approvalId)));
  const submit = () => {
    const t = text.trim();
    if (!t || props.running) return;
    props.onSend(t);
    setText("");
  };

  return (
    <section aria-label="Chat" className="chat-panel">
      <header className="pane-title"><strong>Chat</strong><span>Ask, build, review</span></header>
      <ol aria-label="Conversation" className="conversation">
        {visibleEvents.length === 0 && (
          <li className="chat-welcome"><strong>What are we building?</strong><span>Describe a task, open a project, or type /help.</span></li>
        )}
        {visibleEvents.map((e) => {
          const identity = e.kind === "assistant" ? eventIdentity(e, phaseIdentities) : undefined;
          return <li key={e.id} data-kind={e.kind} className={e.kind === "user" ? "chat-event user" : "chat-event"}>
            <span className="chat-event-mark" style={{ color: eventColor(e.kind) }} aria-hidden>{e.kind === "user" ? "›" : e.kind === "assistant" ? "Aster" : KIND_LABEL[e.kind] ?? e.kind}</span>
            <span className="chat-event-copy">
              {e.text}
              {identity && <small className="model-attribution" title={`Provider: ${identity.provider}`}>{identity.model}</small>}
              {e.kind === "approval" && typeof e.data?.approvalId === "string" && !resolvedApprovals.has(e.data.approvalId) && <span className="approval-actions">
                <button type="button" onClick={() => props.onRespondApproval?.(String(e.data?.approvalId), true)}>Approve</button>
                <button type="button" onClick={() => props.onRespondApproval?.(String(e.data?.approvalId), false)}>Deny</button>
              </span>}
            </span>
          </li>;
        })}
        {props.interactive && <li className="chat-interactive">{props.interactive}</li>}
        {props.running && <li className="processing" aria-live="polite"><span className="agent-current" aria-hidden><i /><i /><i /></span><span>Thinking</span></li>}
      </ol>

      <div className="composer-wrap">
        {props.controls && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{props.controls}</div>}
        <div className="composer-row">
          <span className="composer-prompt" aria-hidden>›</span>
          <textarea
            aria-label="Message"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            className="chat-composer-input"
            placeholder="Message or /command…"
          />
          {props.running ? (
            <button type="button" onClick={props.onStop} style={{ minHeight: 40, padding: "0 14px", borderRadius: 5, border: "1px solid var(--law-color-danger)", background: "transparent", color: "var(--law-color-danger)", cursor: "pointer" }}>Stop</button>
          ) : (
            <button type="button" onClick={submit} aria-label="Send" style={{ minHeight: 40, padding: "0 14px", borderRadius: 5, border: "1px solid var(--law-color-accent)", background: "var(--law-color-accent)", color: "var(--law-color-on-accent)", cursor: "pointer" }}>Send</button>
          )}
        </div>
      </div>
    </section>
  );
}
