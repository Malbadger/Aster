/**
 * PiAdapter public surface for the rest of LAW.
 * Everything outside src/pi-adapter/** imports from here, never from Pi directly.
 */

export type {
  PiAdapter,
  PiSession,
  PiCapabilities,
  ProviderResolution,
  SessionSpec,
  TranscriptRef,
  ContainerEngine,
} from './types.js';
export { PiSdkAdapter } from './sdk-adapter.js';
export { probePiPublicExports } from './probes.js';
export {
  ScriptedPiAdapter,
  defaultScriptedCapabilities,
  type ScriptedConfig,
  type ScriptedSessionPlan,
  type ScriptedStep,
} from './scripted-adapter.js';

import { PiSdkAdapter } from './sdk-adapter.js';
import type { PiAdapter } from './types.js';

/** Construct the real adapter. Deterministic tests/graph runs construct ScriptedPiAdapter directly. */
export function createPiAdapter(): PiAdapter {
  return new PiSdkAdapter();
}
