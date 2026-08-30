/**
 * Run + sub-agent budgets (REQ-021, CLAUDE.md §7). Exhaustion is a distinct, typed
 * outcome — never a silent success and never an identical automatic retry.
 */

export interface Budget {
  maxSteps: number;
  deadlineMs: number;
  defaultMaxAttempts: number;
}

export const DEFAULT_BUDGET: Budget = {
  maxSteps: 40,
  deadlineMs: 15 * 60 * 1000,
  defaultMaxAttempts: 1,
};

export type ExhaustionKind = 'steps' | 'wallclock' | 'iterations' | 'tokens' | 'attempts';

export interface BudgetCheck {
  ok: boolean;
  kind?: ExhaustionKind;
  detail?: string;
}

export class BudgetTracker {
  private readonly budget: Budget;
  private readonly startedAt: number;
  steps = 0;

  constructor(budget: Budget, now: number = Date.now()) {
    this.budget = budget;
    this.startedAt = now;
  }

  /** Check step + wall-clock budgets at a node boundary. */
  check(now: number = Date.now()): BudgetCheck {
    if (this.steps >= this.budget.maxSteps) {
      return { ok: false, kind: 'steps', detail: `max graph steps ${this.budget.maxSteps} reached` };
    }
    if (now - this.startedAt >= this.budget.deadlineMs) {
      return {
        ok: false,
        kind: 'wallclock',
        detail: `wall-clock deadline ${this.budget.deadlineMs}ms exceeded`,
      };
    }
    return { ok: true };
  }

  tick(): void {
    this.steps += 1;
  }
}

/** Sub-agent budget for a bounded Pi session node (CLAUDE.md §6). */
export interface SubAgentBudget {
  maxIterations: number;
  maxTokens: number;
}

export const DEFAULT_SUBAGENT_BUDGET: SubAgentBudget = { maxIterations: 8, maxTokens: 200_000 };

export class SubAgentBudgetTracker {
  private readonly budget: SubAgentBudget;
  iterations = 0;
  tokens = 0;

  constructor(budget: SubAgentBudget) {
    this.budget = budget;
  }

  /** Returns the exhaustion kind if a ceiling is crossed, else null. */
  step(usedTokens: number): ExhaustionKind | null {
    this.iterations += 1;
    this.tokens += usedTokens;
    if (this.iterations > this.budget.maxIterations) return 'iterations';
    if (this.tokens > this.budget.maxTokens) return 'tokens';
    return null;
  }

  atIterationCap(): boolean {
    return this.iterations >= this.budget.maxIterations;
  }
}
