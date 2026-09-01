import React from "react";
import type { AttachmentDescriptor, ChatEvent } from "@law/contracts";

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
  onBeforeSend?: () => boolean | Promise<boolean>;
  onStop: () => void;
  onRespondApproval?: (approvalId: string, approved: boolean) => void;
  controls?: React.ReactNode;
  interactive?: React.ReactNode;
  composerNotice?: React.ReactNode;
  attachments?: AttachmentDescriptor[];
  attachmentBusy?: boolean;
  onChooseAttachments?: () => void;
  onRemoveAttachment?: (attachmentId: string) => void;
  onFiles?: (files: File[]) => void;
}

const KIND_LABEL: Partial<Record<ChatEvent["kind"], string>> = {
  plan: "Thinking",
  tool_call: "Tool",
  tool_result: "Result",
  tool_denied: "Guard",
  handoff: "Handoff",
  approval: "Approval",
  status: "Status",
  error: "Error",
};

function eventColor(kind: ChatEvent["kind"]): string {
  if (kind === "error") return "var(--law-color-danger)";
  if (kind === "tool_denied") return "var(--law-color-warning, var(--law-color-text-muted))";
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
  const [submitting, setSubmitting] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const phaseIdentities = new Map<string, { provider: string; model: string }>();
  for (const event of props.events) {
    if (!event.phaseId) continue;
    const identity = eventIdentity(event, phaseIdentities);
    if (identity) phaseIdentities.set(event.phaseId, identity);
  }
  const conversationalEvents = props.events.filter((event) => event.kind !== "status");
  const visibleEvents = conversationalEvents.filter((event, index) => {
    if (event.kind === "tool_result" && event.data?.ok === false) {
      const previous = conversationalEvents[index - 1];
      if (previous?.kind === "tool_denied" && previous.data?.callId === event.data?.callId) return false;
    }
    if (event.kind !== "assistant" || index === 0) return true;
    const previous = conversationalEvents[index - 1];
    return !(previous?.kind === "user" && Boolean(event.text) && previous.text?.trim() === event.text?.trim());
  });
  const resolvedApprovals = new Set(props.events.filter((event) => event.kind === "status" && typeof event.data?.approvalId === "string").map((event) => String(event.data?.approvalId)));
  const submit = async () => {
    const t = text.trim() || ((props.attachments?.length ?? 0) > 0 ? "Review the attached files." : "");
    if (!t || props.running || submitting) return;
    setSubmitting(true);
    try {
      if (props.onBeforeSend && !(await props.onBeforeSend())) return;
      props.onSend(t); setText("");
    } finally { setSubmitting(false); }
  };

  return (
    <section aria-label="Chat" className={`chat-panel${dragging ? " is-dragging" : ""}`}
      onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); setDragging(false); props.onFiles?.(Array.from(event.dataTransfer.files)); }}>
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
              {e.kind === "tool_denied" ? <details className="blocked-diagnostic"><summary>Aster blocked one background action</summary><span>{e.text}</span></details> : e.text}
              {identity && (identity.provider === "anthropic"
                ? <small className="model-attribution claude-code-attribution" title={`Official Claude Code · ${identity.model}`}><b>Claude Code</b><span>{identity.model}</span></small>
                : <small className="model-attribution" title={`Provider: ${identity.provider}`}>{identity.model}</small>)}
              {eventAttachments(e).length > 0 && <span className="event-attachments">{eventAttachments(e).map((attachment) => <small key={attachment.attachmentId}>{kindMark(attachment.kind)} {attachment.name}</small>)}</span>}
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
        {props.composerNotice}
        {(props.attachments?.length ?? 0) > 0 && <div className="attachment-tray" aria-label="Message attachments">{props.attachments!.map((attachment) => <span className="attachment-chip" key={attachment.attachmentId} title={`${attachment.mimeType} · ${formatBytes(attachment.size)}`}>
          <i aria-hidden>{kindMark(attachment.kind)}</i><span><strong>{attachment.name}</strong><small>{formatBytes(attachment.size)}</small></span><button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => props.onRemoveAttachment?.(attachment.attachmentId)}>×</button>
        </span>)}</div>}
        <div className="composer-row">
          <button className="attach-button" type="button" aria-label="Attach files" title="Attach files" disabled={props.attachmentBusy || props.running} onClick={props.onChooseAttachments}>
            <svg aria-hidden viewBox="0 0 24 24"><path d="M9.5 12.5l5.9-5.9a3 3 0 114.2 4.2l-8.5 8.5a5 5 0 01-7.1-7.1l8.1-8.1" /></svg>
          </button>
          <span className="composer-prompt" aria-hidden>›</span>
          <textarea
            aria-label="Message"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length) { event.preventDefault(); props.onFiles?.(files); } }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={3}
            className="chat-composer-input"
            placeholder="Message or /command…"
          />
          {props.running ? (
            <button type="button" onClick={props.onStop} style={{ minHeight: 40, padding: "0 14px", borderRadius: 5, border: "1px solid var(--law-color-danger)", background: "transparent", color: "var(--law-color-danger)", cursor: "pointer" }}>Stop</button>
          ) : (
            <button type="button" disabled={submitting || props.attachmentBusy} onClick={() => void submit()} aria-label="Send" style={{ minHeight: 40, padding: "0 14px", borderRadius: 5, border: "1px solid var(--law-color-accent)", background: "var(--law-color-accent)", color: "var(--law-color-on-accent)", cursor: "pointer" }}>{submitting ? "Reviewing…" : props.attachmentBusy ? "Attaching…" : "Send"}</button>
          )}
        </div>
      </div>
    </section>
  );
}

function eventAttachments(event: ChatEvent): AttachmentDescriptor[] {
  const value = event.data?.attachments;
  return Array.isArray(value) ? value.filter((item): item is AttachmentDescriptor => Boolean(item && typeof item === "object" && "attachmentId" in item && "name" in item && "kind" in item)) : [];
}

function kindMark(kind: AttachmentDescriptor["kind"]): string { return kind === "image" ? "▧" : kind === "pdf" ? "PDF" : "<>"; }
function formatBytes(size: number): string { return size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`; }
