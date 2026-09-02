import { describe, expect, it } from 'vitest';
import { mapPiEvent, usageFromPiEvent } from '../../src/pi-adapter/sdk-adapter.js';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

function event(value: unknown): AgentSessionEvent {
  return value as AgentSessionEvent;
}

describe('Pi SDK event mapping', () => {
  it('does not render a completed user message as assistant output', () => {
    expect(mapPiEvent(event({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } }))).toBeNull();
  });

  it('renders a completed assistant message', () => {
    expect(mapPiEvent(event({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Hello back.' }] } }))).toEqual({
      kind: 'assistant_message',
      text: 'Hello back.',
    });
  });

  it('surfaces an assistant provider error when the response has no text', () => {
    expect(mapPiEvent(event({ type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: 'Extra usage is required.' } }))).toEqual({
      kind: 'error',
      message: 'Extra usage is required.',
    });
  });

  it('extracts provider usage from a finalized assistant message', () => {
    const completed = event({ type: 'message_end', message: { role: 'assistant', content: [], usage: { input: 84, output: 21 } } });
    expect(usageFromPiEvent(completed)).toEqual({ input: 84, output: 21 });
    expect(usageFromPiEvent(event({ type: 'message_end', message: { role: 'user', usage: { input: 10, output: 0 } } }))).toBeNull();
  });
});
