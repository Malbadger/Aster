import { describe, expect, it } from 'vitest';
import { assertDelegationCaller } from '../../src/mcp/caller-identity.js';

describe('delegation caller identity', () => {
  it('prefers the authoritative active chat model over a model-authored default', () => {
    expect(assertDelegationCaller(
      'anthropic:claude-opus-4-8',
      'anthropic:claude-opus-4-8',
      { ASTER_COORDINATOR_MODEL: 'anthropic:claude-opus-5' },
    )).toBe('anthropic:claude-opus-5');
  });

  it('blocks only an exact recursive model identity', () => {
    expect(() => assertDelegationCaller(
      'anthropic:claude-opus-4-8',
      undefined,
      { ASTER_COORDINATOR_MODEL: 'anthropic:claude-opus-4-8' },
    )).toThrow(/recursive delegation/);
    expect(() => assertDelegationCaller(
      'anthropic:claude-opus-4-8',
      undefined,
      { ASTER_COORDINATOR_MODEL: 'anthropic:claude-opus-5' },
    )).not.toThrow();
  });
});
