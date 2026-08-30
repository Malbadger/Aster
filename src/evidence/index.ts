import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const SECRET_KEY = /(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|cookie)/i;
const SECRET_VALUE = /(sk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._-]+|gh[oprsu]_[A-Za-z0-9]{12,})/gi;

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function redact(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '[REDACTED]');
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redact(v, k)]),
    );
  }
  return value;
}

export interface EvidenceBundle {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  provider: { id: string; model: string; locality: string };
  hashes: Record<string, string>;
  trace: unknown[];
  checks: unknown[];
  diff: string;
  limitations: string[];
}

export function writeEvidenceBundle(path: string, bundle: EvidenceBundle): { path: string; sha256: string } {
  const safe = redact(bundle) as EvidenceBundle;
  const body = `${JSON.stringify(safe, null, 2)}\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { mode: 0o600 });
  return { path, sha256: sha256(body) };
}

export function assertEvidenceContainsNoSecrets(path: string): boolean {
  const body = readFileSync(path, 'utf8');
  SECRET_VALUE.lastIndex = 0;
  const containsSecretValue = SECRET_VALUE.test(body);
  SECRET_VALUE.lastIndex = 0;
  return (
    !containsSecretValue &&
    !/"(?:apiKey|accessToken|refreshToken|password|secret)"\s*:\s*"(?!\[REDACTED\])/i.test(body)
  );
}
