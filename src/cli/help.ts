/** `law --help` (SURF-001): discover commands and the safety model. */

import { LAW_VERSION } from '../version.js';

export function renderHelp(): string {
  return `LAW for Pi — Local Agent Workbench (law ${LAW_VERSION})

USAGE
  law <command> [options]

COMMANDS
  --help                     Show this help and the safety model
  doctor [--json]            Report runtime, Pi, adapter, provider, container, capability status
  configure                  Choose stable Pi, provider profiles, and policies
  provider login <id>        Invoke Pi's own login flow (human-only; LAW never sees credentials)
  run [--workflow <f>]       Validate and execute a workflow
  resume <run>               Inspect a checkpoint and resume a run
  evidence export <run>      Create a redacted, provider-neutral audit bundle
  benchmark [--provider p]   Run and compare versioned exemplar cases
  pi status                  Show stable, tested, global, and latest Pi versions
  pi check-update            Retrieve candidate Pi metadata only
  pi qualify <version>       Isolated diagnosis, repair, tests, audit of a Pi candidate
  pi review <upgrade-id>     Show a candidate's diff, evidence, risk, and rollback
  pi repair <upgrade-id>     Run a bounded compatibility agent in the isolated candidate
  pi promote <upgrade-id>    Owner-only activation of a qualified candidate
  pi rollback [release]      Restore a prior qualified release

SAFETY MODEL (read once)
  - Pi is the harness. It has NO built-in sandbox. LAW's host tool-interception is a
    policy gate, NOT an OS sandbox — do not treat it as one.
  - Unattended MUTATING work runs only inside an approved container (RULE-003).
  - A provider is chosen BEFORE a run and is immutable during it. Mid-run switching is denied.
  - Ollama runs are local loopback only. Remote providers and registry access need explicit,
    separate authorization.
  - Claude Pro is supported; Claude Max is DENIED by owner policy. Any /claude.*max/i model
    is refused before a provider is contacted.
  - Pi owns OAuth credentials. LAW never reads, logs, or exports credential values.
  - No prompt or success message implies production changed before an owner-confirmed promotion.

Run 'law doctor' first to see what is ready or blocked on this machine.`;
}
