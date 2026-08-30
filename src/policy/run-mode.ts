/**
 * Run-mode classification (REQ-011, REQ-012, RULE-003).
 *
 * Three modes: attended host (interactive confirmation allowed), read-only host (no
 * mutation), unattended container (mutation permitted ONLY inside a container).
 * RULE-003: unattended + any mutation capability ⇒ container required; otherwise start
 * is blocked. Destructive actions are denied in every unattended mode (REQ-012).
 */

import type { RunMode } from '../types.js';

export interface RunModeRequest {
  attended: boolean;
  /** Does the run need to mutate files/run mutating tools? */
  mutation: boolean;
  /** Is a usable container engine available (from doctor/probe)? */
  containerAvailable: boolean;
}

export interface RunModeDecision {
  ok: boolean;
  mode?: RunMode;
  reason: string;
  code?: 'UNATTENDED_HOST_MUTATION_BLOCKED' | 'NO_CONTAINER_FOR_UNATTENDED';
  /** Capabilities the classified mode grants. */
  capabilities?: {
    allowMutation: boolean;
    allowDestructive: boolean;
    interactiveConfirmation: boolean;
    requiresContainer: boolean;
  };
}

export function classifyRunMode(req: RunModeRequest): RunModeDecision {
  if (req.attended) {
    if (req.mutation) {
      return {
        ok: true,
        mode: 'attended-host',
        reason: 'Attended host run: mutation permitted with interactive confirmation.',
        capabilities: {
          allowMutation: true,
          allowDestructive: true, // only via explicit interactive confirmation (EXP-006)
          interactiveConfirmation: true,
          requiresContainer: false,
        },
      };
    }
    return {
      ok: true,
      mode: 'read-only-host',
      reason: 'Attended host run with no mutation requested: read-only host.',
      capabilities: {
        allowMutation: false,
        allowDestructive: false,
        interactiveConfirmation: true,
        requiresContainer: false,
      },
    };
  }

  // Unattended.
  if (!req.mutation) {
    return {
      ok: true,
      mode: 'read-only-host',
      reason: 'Unattended read-only run: no mutation, host is acceptable.',
      capabilities: {
        allowMutation: false,
        allowDestructive: false,
        interactiveConfirmation: false,
        requiresContainer: false,
      },
    };
  }

  // Unattended + mutation ⇒ container required (RULE-003).
  if (!req.containerAvailable) {
    return {
      ok: false,
      code: 'NO_CONTAINER_FOR_UNATTENDED',
      reason:
        'Unattended mutating work requires a container, but no usable container engine is available. Start is blocked (RULE-003).',
    };
  }
  return {
    ok: true,
    mode: 'unattended-container',
    reason: 'Unattended mutating work runs in a container with declared mounts and network.',
    capabilities: {
      allowMutation: true,
      allowDestructive: false, // destructive actions are denied in every unattended mode (REQ-012)
      interactiveConfirmation: false,
      requiresContainer: true,
    },
  };
}
