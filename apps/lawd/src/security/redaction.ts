/**
 * Secret detection and redaction (REQ-D-013, REQ-D-040) — zero tolerance.
 *
 * The daemon runs this over anything that could be persisted, exported, logged,
 * or read back: connection input, evidence bundles, log records. It fails CLOSED
 * — a detected secret blocks the write/export and reports the field path, and it
 * never emits the secret itself. Configured secret patterns (admin/user) are
 * added to the built-in set. This module is the single place secrets are judged;
 * nothing else decides "this looks safe."
 */

export interface SecretPattern {
  name: string;
  re: RegExp;
}

/** Built-in high-confidence secret shapes. Kept conservative to avoid false negatives. */
export const BUILTIN_SECRET_PATTERNS: SecretPattern[] = [
  { name: "private-key-block", re: /-----BEGIN[ A-Z]*PRIVATE KEY-----/ },
  { name: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "openai-key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: "github-token", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "bearer-token", re: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

/** Key names whose string values are treated as secrets regardless of shape. */
const SENSITIVE_KEY_RE = /(pass(word|phrase)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization|credential)/i;

/** A reference-name lattice we explicitly allow: UPPER_SNAKE env var names. */
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{1,64}$/;

export interface Finding {
  path: string;
  pattern: string;
}

export class Redactor {
  private readonly patterns: SecretPattern[];

  constructor(configuredPatterns: SecretPattern[] = []) {
    this.patterns = [...BUILTIN_SECRET_PATTERNS, ...configuredPatterns];
  }

  /** Test a bare string for any secret pattern. */
  private matchString(value: string): string | undefined {
    for (const p of this.patterns) {
      if (p.re.test(value)) return p.name;
    }
    return undefined;
  }

  /** Recursively collect secret findings with dotted field paths. */
  scan(value: unknown, basePath = "$"): Finding[] {
    const findings: Finding[] = [];
    const walk = (v: unknown, path: string, keyIsSensitive: boolean): void => {
      if (typeof v === "string") {
        const hit = this.matchString(v);
        if (hit) findings.push({ path, pattern: hit });
        else if (keyIsSensitive && v.trim().length > 0 && !ENV_NAME_RE.test(v.trim())) {
          // A value under a sensitive key that is not a plain env-var NAME is treated as a secret.
          findings.push({ path, pattern: "sensitive-key-value" });
        }
        return;
      }
      if (Array.isArray(v)) {
        v.forEach((item, i) => walk(item, `${path}[${i}]`, false));
        return;
      }
      if (v && typeof v === "object") {
        for (const [k, val] of Object.entries(v)) {
          walk(val, `${path}.${k}`, SENSITIVE_KEY_RE.test(k));
        }
      }
    };
    walk(value, basePath, false);
    return findings;
  }

  /** True when the value contains no secrets. */
  isClean(value: unknown): boolean {
    return this.scan(value).length === 0;
  }

  /**
   * Throw a typed error if any secret is present. `code` is stable so the IPC
   * layer surfaces it as a POLICY_DENIED/refused state without echoing the secret.
   */
  assertClean(value: unknown, context = "value"): void {
    const findings = this.scan(value);
    if (findings.length > 0) {
      const err = new Error(
        `refused: ${findings.length} secret(s) detected in ${context} at ${findings.map((f) => f.path).join(", ")}`,
      ) as Error & { code: string; findings: Finding[] };
      err.code = "SECRET_DETECTED";
      err.findings = findings;
      throw err;
    }
  }

  /** Return a redacted deep copy; matched strings become "[REDACTED:<pattern>]". */
  redact<T>(value: T): T {
    const walk = (v: unknown, keyIsSensitive: boolean): unknown => {
      if (typeof v === "string") {
        const hit = this.matchString(v);
        if (hit) return `[REDACTED:${hit}]`;
        if (keyIsSensitive && v.trim().length > 0 && !ENV_NAME_RE.test(v.trim())) {
          return "[REDACTED:sensitive-key-value]";
        }
        return v;
      }
      if (Array.isArray(v)) return v.map((i) => walk(i, false));
      if (v && typeof v === "object") {
        return Object.fromEntries(
          Object.entries(v).map(([k, val]) => [k, walk(val, SENSITIVE_KEY_RE.test(k))]),
        );
      }
      return v;
    };
    return walk(value, false) as T;
  }
}
