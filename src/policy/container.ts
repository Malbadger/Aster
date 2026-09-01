/**
 * Container command construction for unattended mutation (REQ-014, RULE-003).
 *
 * Aster never claims isolation it hasn't observed. This module builds the exact engine
 * argv (docker/podman) with declared mounts, network policy, and a non-root identity.
 * A live integration test observes mounts/network/user/exit on a host that has an engine
 * (UAT-013); where no engine exists (e.g., this Builder sandbox) that row is
 * NOT-RUN(environment) while the argv construction here stays unit-tested.
 */

import type { ContainerPolicy } from '../config/profiles.js';
import type { ContainerEngine } from '../pi-adapter/index.js';

export interface ContainerPlan {
  engine: Exclude<ContainerEngine, 'none'>;
  argv: string[];
  /** Human-readable description of the enforced boundary, for evidence. */
  boundary: {
    network: ContainerPolicy['network'];
    nonRoot: boolean;
    mounts: Array<{ source: string; target: string; readonly: boolean }>;
    workdir: string;
  };
}

const NETWORK_ARG: Record<ContainerPolicy['network'], string[]> = {
  none: ['--network', 'none'],
  loopback: ['--network', 'none'], // loopback-only inside container == no external network
  explicit: [], // caller must have granted remote-provider; engine default network used
};

export interface BuildContainerOptions {
  engine: Exclude<ContainerEngine, 'none'>;
  policy: ContainerPolicy;
  image: string;
  workspaceRoot: string;
  containerWorkdir?: string;
  /** The command (argv) to run inside the container. */
  command: string[];
  /** UID:GID to run as; defaults to a non-root identity. */
  user?: string;
}

export function buildContainerPlan(opts: BuildContainerOptions): ContainerPlan {
  const workdir = opts.containerWorkdir ?? '/work';
  const user = opts.user ?? '1000:1000';
  const argv: string[] = ['run', '--rm'];

  // Non-root identity (REQ-014).
  if (opts.policy.nonRoot) argv.push('--user', user);

  // No new privileges + drop capabilities: least privilege inside the container.
  argv.push('--security-opt', 'no-new-privileges', '--cap-drop', 'ALL');

  // Network policy.
  argv.push(...NETWORK_ARG[opts.policy.network]);

  // Workspace mount (the run's root maps to the container workdir).
  const workspaceMount = { source: opts.workspaceRoot, target: workdir, readonly: false };
  argv.push('-v', `${workspaceMount.source}:${workspaceMount.target}`);

  // Additional declared mounts.
  const mounts = [workspaceMount, ...opts.policy.mounts];
  for (const m of opts.policy.mounts) {
    argv.push('-v', `${m.source}:${m.target}${m.readonly ? ':ro' : ''}`);
  }

  argv.push('-w', workdir);
  argv.push(opts.image);
  argv.push(...opts.command);

  return {
    engine: opts.engine,
    argv,
    boundary: { network: opts.policy.network, nonRoot: opts.policy.nonRoot, mounts, workdir },
  };
}
