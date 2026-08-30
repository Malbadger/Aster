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
  controls?: React.ReactNode;
}

const KIND_LABEL: Partial<Record<ChatEvent["kind"], string>> = {
  plan: "Plan",
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

export function ChatPanel(props: ChatPanelProps): React.JSX.Element {
  const [text, setText] = React.useState("");
  const submit = () => {
    const t = text.trim();
    if (!t || props.running) return;
    props.onSend(t);
    setText("");
  };

  return (
    <section aria-label="Chat" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <ol aria-label="Conversation" style={{ listStyle: "none", margin: 0, padding: 12, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        {props.events.length === 0 && (
          <li style={{ color: "var(--law-color-text-muted)" }}>Start by describing a task, or type /help for commands.</li>
        )}
        {props.events.map((e) => (
          <li key={e.id} data-kind={e.kind} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {e.kind !== "user" && e.kind !== "assistant" && (
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: eventColor(e.kind) }}>
                {KIND_LABEL[e.kind] ?? e.kind}
              </span>
            )}
            <span style={{ color: e.kind === "user" ? "var(--law-color-text)" : "var(--law-color-text)", fontWeight: e.kind === "user" ? 600 : 400, whiteSpace: "pre-wrap" }}>
              {e.text}
            </span>
          </li>
        ))}
      </ol>

      <div style={{ borderTop: "1px solid var(--law-color-border)", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        {props.controls && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{props.controls}</div>}
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <textarea
            aria-label="Message"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder="Message or /command…"
            style={{ flex: 1, resize: "vertical", minHeight: 40, padding: 8, borderRadius: 5, border: "1px solid var(--law-color-border)", background: "var(--law-color-bg-input)", color: "var(--law-color-text)", fontFamily: "inherit" }}
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
