import { describe, expect, it } from 'vitest';
import { buildContainerPlan } from '../../src/policy/container.js';
import type { ContainerPolicy } from '../../src/config/profiles.js';

const policy: ContainerPolicy = {
  engine: 'docker',
  mounts: [{ source: '/host/cache', target: '/cache', readonly: true }],
  network: 'none',
  nonRoot: true,
};

describe('REQ-014 container plan construction (UAT-013 argv; live observation environment-gated)', () => {
  it('builds a least-privilege, non-root, no-network run command with declared mounts', () => {
    const plan = buildContainerPlan({
      engine: 'docker',
      policy,
      image: 'law-runner:latest',
      workspaceRoot: '/home/operator/proj',
      command: ['law', 'run', '--workflow', 'wf.json'],
    });
    const s = plan.argv.join(' ');
    expect(plan.engine).toBe('docker');
    expect(s).toContain('run --rm');
    expect(s).toContain('--user 1000:1000');
    expect(s).toContain('--security-opt no-new-privileges');
    expect(s).toContain('--cap-drop ALL');
    expect(s).toContain('--network none');
    expect(s).toContain('-v /home/operator/proj:/work');
    expect(s).toContain('-v /host/cache:/cache:ro');
    expect(s).toContain('-w /work');
    expect(plan.boundary.nonRoot).toBe(true);
    expect(plan.boundary.network).toBe('none');
  });

  it('omits --user when nonRoot is false (still recorded in boundary)', () => {
    const plan = buildContainerPlan({
      engine: 'podman',
      policy: { ...policy, nonRoot: false },
      image: 'img',
      workspaceRoot: '/w',
      command: ['true'],
    });
    expect(plan.argv.join(' ')).not.toContain('--user');
    expect(plan.boundary.nonRoot).toBe(false);
  });
});
