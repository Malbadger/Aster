/**
 * Host capability probes used by the real adapter for `law doctor` (REQ-004).
 * Kept side-effect-light and injectable so doctor can be tested with fixtures.
 */

import { execFile, spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { promisify } from 'node:util';
import type { ContainerEngine } from './types.js';

const pExecFile = promisify(execFile);

export interface ContainerProbeResult {
  engine: ContainerEngine;
  available: boolean;
  detail?: string;
}

/** Detect a usable local container engine. Records the exact engine, never assumes it (BUILD-004). */
export async function detectContainerEngine(timeoutMs = 4000): Promise<ContainerProbeResult> {
  for (const engine of ['docker', 'podman'] as const) {
    try {
      const { stdout } = await pExecFile(engine, ['version', '--format', '{{.Server.Version}}'], {
        timeout: timeoutMs,
      });
      const v = stdout.trim();
      if (v) return { engine, available: true, detail: `${engine} server ${v}` };
    } catch (err) {
      // binary present but daemon down, or binary absent: keep probing.
      const msg = err instanceof Error ? err.message : String(err);
      if (/Cannot connect|daemon|refused|not running/i.test(msg)) {
        // engine present but not usable — report as unavailable with detail.
        return { engine, available: false, detail: `${engine} present but not usable: ${firstLine(msg)}` };
      }
    }
  }
  return { engine: 'none', available: false, detail: 'no docker or podman engine detected' };
}

/** Check whether an Ollama server is reachable on loopback (no credentials, BN-003). */
export function ollamaLoopbackReachable(port = 11434, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function firstLine(s: string): string {
  return s.split('\n')[0] ?? s;
}

/** Probe Pi's public runtime exports inside a selected project root. */
export function probePiPublicExports(cwd: string): { ok: boolean; exports: string[]; detail: string } {
  const script =
    "import('@earendil-works/pi-coding-agent').then(m=>console.log(JSON.stringify(Object.keys(m).sort())))";
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
  });
  const detail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
  if (result.status !== 0) return { ok: false, exports: [], detail };
  try {
    return { ok: true, exports: JSON.parse(detail.split('\n').at(-1) ?? '[]') as string[], detail };
  } catch {
    return { ok: false, exports: [], detail: `invalid public export probe: ${detail}` };
  }
}
