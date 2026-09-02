export interface DelegationEvent {
  kind: string;
  text?: string;
  data?: Record<string, unknown>;
}

export interface DelegationEventsResult {
  events: DelegationEvent[];
  taskStatus: string;
}

export interface DelegationSnapshot {
  task_id: string;
  status: string;
  provider?: string;
  model?: string;
  mode?: string;
  response?: string;
  error?: string;
  usage: { input: number; output: number };
  timed_out?: boolean;
}

export function summarizeDelegation(taskId: string, result: DelegationEventsResult): DelegationSnapshot {
  const assistant = result.events.filter((event) => event.kind === 'assistant' && event.text?.trim()).at(-1);
  const error = result.events.filter((event) => event.kind === 'error').at(-1);
  const identityEvent = [...result.events].reverse().find((event) => event.data?.identity);
  const identity = identityEvent?.data?.identity as { provider?: string; model?: string; mode?: string } | undefined;
  const usage = result.events.reduce((total, event) => {
    const item = event.data?.usage as { input?: number; output?: number } | undefined;
    return { input: total.input + (item?.input ?? 0), output: total.output + (item?.output ?? 0) };
  }, { input: 0, output: 0 });
  const emptyCompletion = result.taskStatus === 'completed' && !assistant && !error;
  return {
    task_id: taskId,
    status: emptyCompletion ? 'error' : result.taskStatus,
    ...(identity?.provider ? { provider: identity.provider } : {}),
    ...(identity?.model ? { model: identity.model } : {}),
    ...(identity?.mode ? { mode: identity.mode } : {}),
    ...(assistant?.text ? { response: assistant.text } : {}),
    ...(error?.text || emptyCompletion ? { error: error?.text ?? 'Delegated model completed without returning a response.' } : {}),
    usage,
  };
}

export async function waitForDelegation(
  taskId: string,
  timeoutMs: number,
  pollMs: number,
  getEvents: () => Promise<DelegationEventsResult>,
  sleep: (delayMs: number) => Promise<void> = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
): Promise<DelegationSnapshot> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const snapshot = summarizeDelegation(taskId, await getEvents());
    if (snapshot.status !== 'active') return snapshot;
    if (Date.now() >= deadline) return { ...snapshot, timed_out: true };
    await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
  }
}

export function delegationMarkdown(snapshot: DelegationSnapshot): string {
  const detail = snapshot.error ?? snapshot.response ?? (snapshot.timed_out ? 'The wait timed out; call aster_delegate_wait again with this task ID.' : 'The delegated model is still working.');
  return `# Delegation ${snapshot.task_id}\n\n- Status: ${snapshot.status}\n- Provider: ${snapshot.provider ?? 'pending'}\n- Model: ${snapshot.model ?? 'pending'}\n- Mode: ${snapshot.mode ?? 'pending'}\n- Usage: ${snapshot.usage.input} input · ${snapshot.usage.output} output\n\n${detail}`;
}
