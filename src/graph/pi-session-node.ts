/**
 * Bounded Pi session node (REQ-016/017, CLAUDE.md §6).
 *
 * Wraps a PiAdapter session as ONE graph node: an explicit brief built from named reads,
 * an own tool allowlist + interceptor, a hard iteration/token budget, and a small
 * STRUCTURED result. The transcript stays in Pi session storage; only a reference plus the
 * structured summary leave the node (no transcript in shared state).
 */

import type { ProviderProfile } from '../types.js';
import type { PiAdapter } from '../pi-adapter/index.js';
import { RunAuthorization } from '../policy/authorization.js';
import { makeToolInterceptor } from '../policy/tool-interceptor.js';
import { DEFAULT_SUBAGENT_BUDGET, type SubAgentBudget, SubAgentBudgetTracker } from './budget.js';
import type { NodeContract, NodeResult, NodeRunContext } from './types.js';

export interface PiSessionSummary {
  status: 'done' | 'invalid_output' | 'error' | 'cancelled' | 'exhausted';
  text: string;
  toolCallCount: number;
  deniedCount: number;
  usage: { input: number; output: number };
  transcript: { sessionId: string; storage: 'pi-session' };
  sideEffect: boolean;
}

export interface PiSessionNodeOptions {
  name: string;
  reads: string[];
  writes: string[];
  tools: string[];
  adapter: PiAdapter;
  profile: ProviderProfile;
  requestedModel?: string;
  workspaceRoot: string;
  allowMutation: boolean;
  allowDestructive?: boolean;
  authorization?: RunAuthorization;
  confirm?: (call: { tool: string; input: unknown; callId: string }) => boolean;
  pathPolicy?: (relativePath: string) => { ok: boolean; reason: string };
  /** Build the explicit brief string from this node's named reads. Never the whole state. */
  brief: (reads: Record<string, unknown>) => string;
  budget?: SubAgentBudget;
  /** Where the structured summary is written. */
  resultKey: string;
  /** Optional structured-output validation; false ⇒ invalid_output. */
  validateSummary?: (summary: PiSessionSummary) => boolean;
  maxAttempts?: number;
}

export function makePiSessionNode(opts: PiSessionNodeOptions): NodeContract {
  const budget = opts.budget ?? DEFAULT_SUBAGENT_BUDGET;
  const node: NodeContract = {
    name: opts.name,
    reads: opts.reads,
    writes: opts.writes,
    tools: opts.tools,
    ...(opts.maxAttempts ? { maxAttempts: opts.maxAttempts } : {}),
    async run(ctx: NodeRunContext): Promise<NodeResult> {
      const interceptor = makeToolInterceptor({
        workspaceRoot: opts.workspaceRoot,
        tools: opts.tools,
        allowMutation: opts.allowMutation,
        allowDestructive: opts.allowDestructive ?? false,
        provider: opts.profile.provider,
        authorization: opts.authorization ?? new RunAuthorization([]),
        ...(opts.confirm ? { confirm: opts.confirm } : {}),
        ...(opts.pathPolicy ? { pathPolicy: opts.pathPolicy } : {}),
      });

      const session = await opts.adapter.openSession({
        profile: opts.profile,
        ...(opts.requestedModel ? { requestedModel: opts.requestedModel } : {}),
        tools: opts.tools,
        interceptor,
        workspaceRoot: opts.workspaceRoot,
        allowMutation: opts.allowMutation,
      });

      const tracker = new SubAgentBudgetTracker(budget);
      const usage = { input: 0, output: 0 };
      const toolCalls: NodeResult['toolCalls'] = [];
      let deniedCount = 0;
      let text = '';
      let sideEffect = false;
      let status: PiSessionSummary['status'] = 'done';

      const prompt = opts.brief(ctx.reads);
      try {
        for await (const ev of session.submit(prompt)) {
          switch (ev.kind) {
            case 'assistant_message': {
              text += ev.text;
              const exhausted = tracker.step(0);
              if (exhausted) {
                status = 'exhausted';
                await session.abort();
              }
              break;
            }
            case 'tool_call': {
              toolCalls.push({ name: ev.tool, ok: true });
              sideEffect = sideEffect || ev.tool === 'write' || ev.tool === 'edit';
              const exhausted = tracker.step(0);
              if (exhausted) {
                status = 'exhausted';
                await session.abort();
              }
              break;
            }
            case 'tool_denied': {
              deniedCount += 1;
              toolCalls.push({ name: ev.tool, ok: false, denied: true, reason: ev.reason });
              break;
            }
            case 'tool_result': {
              const last = toolCalls[toolCalls.length - 1];
              if (last && last.name === ev.tool) last.ok = ev.ok;
              break;
            }
            case 'usage': {
              usage.input += ev.input;
              usage.output += ev.output;
              const exhausted = tracker.step(ev.input + ev.output);
              if (exhausted) {
                status = 'exhausted';
                await session.abort();
              }
              break;
            }
            case 'error': {
              status = 'error';
              break;
            }
            default:
              break;
          }
          if (status === 'exhausted') break;
        }
      } finally {
        await session.dispose();
      }

      const summary: PiSessionSummary = {
        status,
        text: text.length > 2000 ? `${text.slice(0, 1997)}...` : text,
        toolCallCount: toolCalls.filter((t) => !t.denied).length,
        deniedCount,
        usage,
        transcript: session.transcriptRef(),
        sideEffect,
      };

      if (status === 'done' && opts.validateSummary && !opts.validateSummary(summary)) {
        summary.status = 'invalid_output';
      }

      const nodeStatus: NodeResult['status'] =
        summary.status === 'done'
          ? 'ok'
          : summary.status === 'invalid_output'
            ? 'invalid_output'
            : summary.status === 'exhausted'
              ? 'exhausted'
              : summary.status === 'cancelled'
                ? 'cancelled'
                : 'error';

      return {
        status: nodeStatus,
        writes: { [opts.resultKey]: summary },
        summary,
        usage,
        toolCalls,
        sideEffect,
        ...(summary.status === 'error' ? { error: 'pi session reported an error' } : {}),
      };
    },
  };
  return node;
}
