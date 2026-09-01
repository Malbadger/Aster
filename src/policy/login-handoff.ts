/**
 * Provider login handoff (REQ-006, SURF-004, EXP-003).
 *
 * Aster never authenticates on the operator's behalf and never touches credential values.
 * This produces a human-only handoff descriptor pointing at Pi's own login flow.
 */

import type { ProviderId } from '../types.js';

export interface LoginHandoff {
  provider: ProviderId;
  humanOnly: true;
  /** The Pi-owned command the operator runs themselves. */
  piLoginHint: string;
  message: string;
}

export function loginHandoff(provider: ProviderId): LoginHandoff {
  const extraUsage =
    provider === 'claude-pro'
      ? ' Claude Pro is supported and Claude Max is denied; any applicable Claude extra usage requires your explicit action.'
      : '';
  return {
    provider,
    humanOnly: true,
    piLoginHint: 'pi  (then use Pi’s /login for the selected provider)',
    message: `Authentication for "${provider}" is owned by Pi and is human-only. Aster will not log in for you and never sees your credentials.${extraUsage}`,
  };
}
