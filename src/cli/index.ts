#!/usr/bin/env node
/**
 * `law` CLI entry (REQ-001). Thin dispatcher: parse argv, route to a command, map the
 * command's typed result to an exit code. Commands are added as build phases land; an
 * unknown command is a clean error, never a stub.
 */

import { createPiAdapter } from '../pi-adapter/index.js';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderBenchmark, runRequiredExemplars } from '../benchmark/index.js';
import { buildDoctorReport, renderDoctorJson, renderDoctorText } from './doctor.js';
import { renderHelp } from './help.js';
import { runPiCommand } from './pi.js';
import { runEvidenceCommand } from './evidence.js';
import { runConfigureCommand, runProviderCommand, runResumeCommand, runWorkflowCommand } from './operator.js';

export interface CliIO {
  out: (s: string) => void;
  err: (s: string) => void;
}

const defaultIO: CliIO = {
  out: (s) => process.stdout.write(`${s}\n`),
  err: (s) => process.stderr.write(`${s}\n`),
};

export async function runCli(argv: string[], io: CliIO = defaultIO): Promise<number> {
  const [command, ...rest] = argv;
  const json = rest.includes('--json');

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    io.out(renderHelp());
    return 0;
  }

  switch (command) {
    case 'doctor': {
      const caps = await createPiAdapter().capabilities();
      const report = buildDoctorReport(caps);
      io.out(json ? renderDoctorJson(report) : renderDoctorText(report));
      // exit 0 when core is present/usable (ready or degraded); non-zero only when blocked.
      return report.status === 'blocked' ? 3 : 0;
    }
    case 'benchmark': {
      const providerIndex = rest.indexOf('--provider');
      const provider = providerIndex >= 0 ? (rest[providerIndex + 1] ?? 'ollama') : 'ollama';
      const results = runRequiredExemplars();
      io.out(renderBenchmark(results, provider));
      return results.every((r) => r.pass) ? 0 : 4;
    }
    case 'configure':
      return runConfigureCommand(rest, io);
    case 'provider':
      return runProviderCommand(rest, io);
    case 'run':
      return runWorkflowCommand(rest, io);
    case 'resume':
      return runResumeCommand(rest, io);
    case 'pi':
      return runPiCommand(rest, io);
    case 'evidence':
      return runEvidenceCommand(rest, io);
    default:
      io.err(`law: unknown command "${command}". Run 'law --help'.`);
      return 2;
  }
}

// Execute when invoked as a program (not when imported by tests).
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  runCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(
        `law: fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exit(1);
    },
  );
}
