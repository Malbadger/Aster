import { describe, expect, it } from 'vitest';
import { summarizeDelegation, waitForDelegation } from '../../src/mcp/delegation.js';

describe('Aster delegation result handling', () => {
  it('reports attribution, actual mode, response, and accumulated usage', () => {
    const result = summarizeDelegation('task-1', {
      taskStatus: 'completed',
      events: [
        { kind: 'status', data: { identity: { provider: 'ollama', model: 'ollama:qwen', mode: 'full-access' } } },
        { kind: 'status', data: { usage: { input: 80, output: 20 } } },
        { kind: 'status', data: { usage: { input: 10, output: 5 } } },
        { kind: 'assistant', text: 'Done.' },
      ],
    });
    expect(result).toMatchObject({ status: 'completed', provider: 'ollama', model: 'ollama:qwen', mode: 'full-access', response: 'Done.', usage: { input: 90, output: 25, turns: 2, semantics: 'cumulative-context-processed' } });
  });

  it('waits without external timer tools and can return a resumable timeout', async () => {
    let calls = 0;
    const timedOut = await waitForDelegation('task-2', 0, 1, async () => ({ taskStatus: 'active', events: [] }), async () => {});
    expect(timedOut).toMatchObject({ task_id: 'task-2', status: 'active', timed_out: true });
    const completed = await waitForDelegation('task-2', 1_000, 1, async () => {
      calls += 1;
      return calls === 1 ? { taskStatus: 'active', events: [] } : { taskStatus: 'completed', events: [{ kind: 'assistant', text: 'Complete' }] };
    }, async () => {});
    expect(completed).toMatchObject({ status: 'completed', response: 'Complete' });
  });
});
