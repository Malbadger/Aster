/**
 * `law doctor` (SURF-002 / REQ-004): report runtime, Pi, adapter, provider, container,
 * and capability status in text and JSON, with the same status taxonomy in both
 * (checking/ready/degraded/blocked) and an explicit next-safe-action recovery list.
 */

import type { PiCapabilities } from '../pi-adapter/index.js';
import { LAW_VERSION } from '../version.js';

export type DoctorStatus = 'ready' | 'degraded' | 'blocked';

export interface DoctorReport {
  status: DoctorStatus;
  law: string;
  facets: {
    runtime: { status: 'ok'; node: string; platform: string; arch: string };
    pi: {
      status: 'ok' | 'incompatible' | 'missing';
      version: string | null;
      testedRange: string;
      source: 'project-local' | 'missing';
    };
    adapter: { status: 'ok'; id: string; version: string };
    providers: Array<{
      id: string;
      authAvailable: string;
      status: 'ok' | 'unavailable' | 'unknown';
      note?: string;
    }>;
    container: { status: 'ok' | 'unavailable'; engine: string; available: boolean; detail?: string };
    models: { status: 'ok' | 'unavailable' };
  };
  recovery: string[];
}

export function buildDoctorReport(caps: PiCapabilities): DoctorReport {
  const recovery: string[] = [];

  let piStatus: 'ok' | 'incompatible' | 'missing';
  if (caps.pi.source === 'missing' || caps.pi.version === null) {
    piStatus = 'missing';
    recovery.push(
      'Install the project-local Pi qualification target: `npm ci` in law-pi (adds @earendil-works/pi-coding-agent 0.84.4).',
    );
  } else if (!caps.pi.compatible) {
    piStatus = 'incompatible';
    recovery.push(
      `Installed Pi ${caps.pi.version} is outside tested range ${caps.pi.testedRange}. Qualify it via \`law pi qualify\` before use; it is not auto-trusted.`,
    );
  } else {
    piStatus = 'ok';
  }

  const providers = caps.providers.map((p) => {
    let status: 'ok' | 'unavailable' | 'unknown';
    if (p.authAvailable === 'available') status = 'ok';
    else if (p.authAvailable === 'unknown') status = 'unknown';
    else status = 'unavailable';
    const base = { id: p.id, authAvailable: p.authAvailable, status };
    return p.note ? { ...base, note: p.note } : base;
  });
  if (providers.every((p) => p.status !== 'ok')) {
    recovery.push(
      'No provider is confirmed available. For local runs start Ollama (loopback); for subscription providers run `law provider login <id>` (human-only).',
    );
  }

  const container = {
    status: (caps.container.available ? 'ok' : 'unavailable') as 'ok' | 'unavailable',
    engine: caps.container.engine,
    available: caps.container.available,
    ...(caps.container.detail ? { detail: caps.container.detail } : {}),
  };
  if (!caps.container.available) {
    recovery.push(
      'No usable container engine detected. Attended and read-only host runs still work; UNATTENDED mutation is blocked until a container engine is available (RULE-003).',
    );
  }

  // Overall status.
  let status: DoctorStatus;
  if (piStatus === 'missing') {
    status = 'blocked';
  } else if (
    piStatus === 'incompatible' ||
    !caps.container.available ||
    providers.every((p) => p.status !== 'ok')
  ) {
    status = 'degraded';
  } else {
    status = 'ready';
  }

  return {
    status,
    law: LAW_VERSION,
    facets: {
      runtime: {
        status: 'ok',
        node: caps.runtime.node,
        platform: caps.runtime.platform,
        arch: caps.runtime.arch,
      },
      pi: {
        status: piStatus,
        version: caps.pi.version,
        testedRange: caps.pi.testedRange,
        source: caps.pi.source,
      },
      adapter: { status: 'ok', id: caps.adapter.id, version: caps.adapter.version },
      providers,
      container,
      models: { status: caps.models.registryAvailable ? 'ok' : 'unavailable' },
    },
    recovery,
  };
}

const MARK: Record<string, string> = {
  ok: '[ok]',
  ready: '[ready]',
  degraded: '[degraded]',
  blocked: '[blocked]',
  incompatible: '[incompatible]',
  missing: '[missing]',
  unavailable: '[unavailable]',
  unknown: '[unknown]',
};

/** Render a text report. `color` currently unused by design: status is carried by text, never color-only (A11y). */
export function renderDoctorText(r: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`Aster doctor  ${MARK[r.status]}  (law ${r.law})`);
  lines.push(
    `  runtime    ${MARK[r.facets.runtime.status]} node ${r.facets.runtime.node} ${r.facets.runtime.platform}/${r.facets.runtime.arch}`,
  );
  lines.push(
    `  pi         ${MARK[r.facets.pi.status]} version ${r.facets.pi.version ?? '(none)'} tested ${r.facets.pi.testedRange} (${r.facets.pi.source})`,
  );
  lines.push(
    `  adapter    ${MARK[r.facets.adapter.status]} ${r.facets.adapter.id}@${r.facets.adapter.version}`,
  );
  for (const p of r.facets.providers) {
    lines.push(
      `  provider   ${MARK[p.status]} ${p.id} auth=${p.authAvailable}${p.note ? `  (${p.note})` : ''}`,
    );
  }
  lines.push(
    `  container  ${MARK[r.facets.container.status]} engine=${r.facets.container.engine}${r.facets.container.detail ? `  (${r.facets.container.detail})` : ''}`,
  );
  lines.push(`  models     ${MARK[r.facets.models.status]}`);
  if (r.recovery.length) {
    lines.push('  next safe actions:');
    for (const rec of r.recovery) lines.push(`    - ${rec}`);
  }
  return lines.join('\n');
}

export function renderDoctorJson(r: DoctorReport): string {
  return JSON.stringify(r, null, 2);
}
