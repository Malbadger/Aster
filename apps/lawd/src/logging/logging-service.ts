/**
 * Logging service (BUILD-D-017). Community logging is OFF by default and
 * user-controlled; a managed policy can require logging that users inspect but
 * cannot override (RULE-D-005). Every record is redacted before it is written;
 * credentials and configured secret patterns never appear, and a redaction
 * failure drops the record (fail closed). Local JSONL only (OPEN-D-004).
 */
import type { LogPolicy, LogMode } from "@law/contracts";
import { Redactor } from "../security/redaction.js";

export interface LogSink {
  write(line: string): void;
}

export interface LoggingDeps {
  sink?: LogSink;
  redactor?: Redactor;
  now?: () => Date;
  /** A managed policy in force; when present, users cannot override it. */
  managedPolicy?: LogPolicy;
}

const OFF: LogPolicy = { mode: "off", managed: false, fields: [], retentionDays: 30, destination: "none" };

export class LoggingService {
  private policy: LogPolicy;
  private readonly redactor: Redactor;
  private readonly sink?: LogSink;
  private readonly now: () => Date;

  constructor(private readonly deps: LoggingDeps = {}) {
    this.redactor = deps.redactor ?? new Redactor();
    this.sink = deps.sink;
    this.now = deps.now ?? (() => new Date());
    this.policy = deps.managedPolicy ? { ...deps.managedPolicy, managed: true } : { ...OFF };
  }

  getPolicy(): LogPolicy {
    return this.policy;
  }

  setPolicy(input: { mode: Exclude<LogMode, "managed">; fields: string[]; retentionDays: number; destination: "none" | "local-jsonl" }): {
    policy: LogPolicy;
    refused: boolean;
    reason?: string;
  } {
    if (this.policy.managed) {
      return { policy: this.policy, refused: true, reason: "A managed logging policy is in force and cannot be overridden by the user (RULE-D-005)." };
    }
    this.policy = { mode: input.mode, managed: false, fields: input.fields, retentionDays: input.retentionDays, destination: input.destination };
    return { policy: this.policy, refused: false };
  }

  /** Append an operational/audit record. No-op when logging is off. Always redacted. */
  append(record: Record<string, unknown>): boolean {
    if (this.policy.mode === "off") return false;
    if (this.policy.destination !== "local-jsonl" || !this.sink) return false;
    let safe: Record<string, unknown>;
    try {
      safe = this.redactor.redact(record);
      // Defense in depth: if any secret survived redaction, refuse to write.
      if (!this.redactor.isClean(safe)) return false;
    } catch {
      return false; // fail closed
    }
    this.sink.write(JSON.stringify({ at: this.now().toISOString(), ...safe }));
    return true;
  }
}
