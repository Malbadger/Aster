import { describe, expect, it } from 'vitest';
import { renderUat, runUatBattery } from '../../src/uat/index.js';
describe('UAT battery', () => {
  const first = runUatBattery();
  const second = runUatBattery();
  it('covers all 30 controlled rows plus the live Pi integration row', () =>
    expect(first.map((r) => r.id)).toEqual(
      Array.from({ length: 31 }, (_, i) => `UAT-${String(i + 1).padStart(3, '0')}`),
    ));
  it('has no deterministic failures', () => expect(first.every((r) => r.result !== 'FAIL')).toBe(true));
  it('reports live container observation honestly', () =>
    expect(['PASS', 'NOT-RUN(environment)']).toContain(first.find((r) => r.id === 'UAT-013')?.result));
  it('does not claim the owner-authenticated Pi integration passed', () =>
    expect(first.find((r) => r.id === 'UAT-031')?.result).toBe('NOT-RUN(human-only)'));
  it('is identical across two clean logical passes', () => expect(second).toEqual(first));
  it('records commands and exit codes for every PASS', () =>
    expect(first.filter((r) => r.result === 'PASS').every((r) => r.command && r.exitCode === 0)).toBe(true));
  it('renders closing sentinel', () => expect(renderUat(first, 1)).toContain('UAT PASS pass=1'));
});
