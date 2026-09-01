/**
 * Real Pi tool-interception wiring (REQ-013).
 *
 * Builds a Pi ExtensionFactory that registers a `tool_call` handler. Pi fires this
 * BEFORE a tool executes; returning `{ block: true, reason }` denies it. This is the
 * genuine pre-execution gate — Aster's policy decides, Pi enforces the block.
 *
 * This module is the ONLY place (besides the adapters) allowed to touch Pi types,
 * and it uses only the public `.` entry (import-guard enforced).
 */

import type { ExtensionAPI, ToolCallEvent, ToolCallEventResult } from '@earendil-works/pi-coding-agent';
import type { ToolInterceptor } from '../types.js';

/**
 * Create an inline Pi extension that applies a Aster ToolInterceptor to every tool call.
 * `onDecision` lets the adapter surface allow/deny into its normalized event stream.
 */
export function makeInterceptionExtension(
  interceptor: ToolInterceptor,
  onDecision?: (d: { tool: string; callId: string; denied: boolean; reason: string }) => void,
) {
  return (pi: ExtensionAPI): void => {
    pi.on('tool_call', (event: ToolCallEvent): ToolCallEventResult => {
      const call = { tool: event.toolName, input: event.input, callId: event.toolCallId };
      const decision = interceptor(call);
      onDecision?.({
        tool: call.tool,
        callId: call.callId,
        denied: decision.decision === 'deny',
        reason: decision.reason,
      });
      if (decision.decision === 'deny') {
        return { block: true, reason: decision.reason };
      }
      return {};
    });
  };
}
