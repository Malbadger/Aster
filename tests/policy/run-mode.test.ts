import { describe, expect, it } from 'vitest';
import { classifyRunMode } from '../../src/policy/run-mode.js';

describe('RULE-003 run-mode classification (REQ-011, REQ-012, UAT-010)', () => {
  it('attended + mutation ⇒ attended-host with interactive confirmation', () => {
    const d = classifyRunMode({ attended: true, mutation: true, containerAvailable: false });
    expect(d.ok).toBe(true);
    expect(d.mode).toBe('attended-host');
    expect(d.capabilities?.allowMutation).toBe(true);
    expect(d.capabilities?.interactiveConfirmation).toBe(true);
  });

  it('attended + no mutation ⇒ read-only-host', () => {
    const d = classifyRunMode({ attended: true, mutation: false, containerAvailable: false });
    expect(d.mode).toBe('read-only-host');
    expect(d.capabilities?.allowMutation).toBe(false);
  });

  it('unattended + no mutation ⇒ read-only-host on host', () => {
    const d = classifyRunMode({ attended: false, mutation: false, containerAvailable: false });
    expect(d.ok).toBe(true);
    expect(d.mode).toBe('read-only-host');
  });

  it('unattended + mutation + no container ⇒ BLOCKED (RULE-003)', () => {
    const d = classifyRunMode({ attended: false, mutation: true, containerAvailable: false });
    expect(d.ok).toBe(false);
    expect(d.code).toBe('NO_CONTAINER_FOR_UNATTENDED');
  });

  it('unattended + mutation + container ⇒ unattended-container, destructive denied', () => {
    const d = classifyRunMode({ attended: false, mutation: true, containerAvailable: true });
    expect(d.ok).toBe(true);
    expect(d.mode).toBe('unattended-container');
    expect(d.capabilities?.requiresContainer).toBe(true);
    expect(d.capabilities?.allowDestructive).toBe(false);
  });
});
