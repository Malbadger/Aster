import { describe, expect, it } from 'vitest';
import { buildDoctorReport, renderDoctorJson, renderDoctorText } from '../src/cli/doctor.js';
import { defaultScriptedCapabilities } from '../src/pi-adapter/index.js';
import type { PiCapabilities } from '../src/pi-adapter/index.js';

const ready: PiCapabilities = defaultScriptedCapabilities({
  providers: [
    { id: 'ollama', authKind: 'none', authAvailable: 'available', locality: 'local' },
    { id: 'chatgpt', authKind: 'subscription-oauth', authAvailable: 'unknown', locality: 'any' },
    { id: 'claude-pro', authKind: 'subscription-oauth', authAvailable: 'unknown', locality: 'any' },
  ],
  container: { engine: 'docker', available: true, detail: 'docker server 27.0' },
});

describe('law doctor (REQ-004, UAT-003) status taxonomy', () => {
  it('ready: pi ok, provider available, container available', () => {
    const r = buildDoctorReport(ready);
    expect(r.status).toBe('ready');
    expect(r.facets.pi.status).toBe('ok');
  });

  it('blocked: Pi missing', () => {
    const caps = defaultScriptedCapabilities({
      pi: { version: null, source: 'missing', compatible: false, testedRange: '0.84.4' },
    });
    const r = buildDoctorReport(caps);
    expect(r.status).toBe('blocked');
    expect(r.facets.pi.status).toBe('missing');
    expect(r.recovery.join(' ')).toMatch(/npm ci/);
  });

  it('degraded/incompatible: Pi present but outside tested range', () => {
    const caps = defaultScriptedCapabilities({
      pi: { version: '0.85.0', source: 'project-local', compatible: false, testedRange: '0.84.4' },
      container: { engine: 'docker', available: true },
    });
    const r = buildDoctorReport(caps);
    expect(r.facets.pi.status).toBe('incompatible');
    expect(r.status).toBe('degraded');
    expect(r.recovery.join(' ')).toMatch(/law pi qualify/);
  });

  it('degraded: no container engine ⇒ unattended mutation blocked message', () => {
    const caps = defaultScriptedCapabilities({ ...ready, container: { engine: 'none', available: false } });
    const r = buildDoctorReport(caps);
    expect(r.status).toBe('degraded');
    expect(r.facets.container.status).toBe('unavailable');
    expect(r.recovery.join(' ')).toMatch(/RULE-003/);
  });

  it('degraded: no provider confirmed available', () => {
    const caps = defaultScriptedCapabilities({
      providers: [
        { id: 'ollama', authKind: 'none', authAvailable: 'absent', locality: 'local' },
        { id: 'chatgpt', authKind: 'subscription-oauth', authAvailable: 'absent', locality: 'any' },
        { id: 'claude-pro', authKind: 'subscription-oauth', authAvailable: 'absent', locality: 'any' },
      ],
      container: { engine: 'docker', available: true },
    });
    const r = buildDoctorReport(caps);
    expect(r.status).toBe('degraded');
    expect(r.recovery.join(' ')).toMatch(/provider login/);
  });

  it('JSON and text carry the same status taxonomy (no color-only meaning)', () => {
    const r = buildDoctorReport(ready);
    const json = JSON.parse(renderDoctorJson(r));
    expect(json.status).toBe(r.status);
    const text = renderDoctorText(r);
    expect(text).toContain('[ready]');
    // status is present as text, not conveyed by color
    expect(text).toMatch(/pi\s+\[ok\]/);
  });
});
