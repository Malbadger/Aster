/**
 * Checkpointing + resume gating (REQ-018/019/020, CLAUDE.md §8).
 *
 * A checkpoint is (runId, step, nextNode, state, hashes) written atomically at a node
 * boundary. Resume is refused unless workflow, config, adapter, and Pi hashes all match
 * (REQ-019). Side-effecting nodes are gated on resume by their recorded result (REQ-020).
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunState } from './types.js';

export interface CheckpointHashes {
  workflowHash: string;
  configHash: string;
  adapterVersion: string;
  piVersion: string;
}

export interface Checkpoint {
  runId: string;
  step: number;
  nextNode: string;
  state: RunState;
  hashes: CheckpointHashes;
}

export function checkpointDirFor(baseDir: string, runId: string): string {
  return join(baseDir, runId);
}

/** Atomic node-boundary write: temp file then rename (REQ-018). */
export function writeCheckpoint(baseDir: string, cp: Checkpoint): string {
  const dir = checkpointDirFor(baseDir, cp.runId);
  mkdirSync(dir, { recursive: true });
  const finalPath = join(dir, `${String(cp.step).padStart(6, '0')}.json`);
  const tmpPath = `${finalPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(cp, null, 2));
  renameSync(tmpPath, finalPath);
  return finalPath;
}

export function readLatestCheckpoint(baseDir: string, runId: string): Checkpoint | null {
  const dir = checkpointDirFor(baseDir, runId);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  files.sort();
  const latest = files[files.length - 1] as string;
  return JSON.parse(readFileSync(join(dir, latest), 'utf8')) as Checkpoint;
}

export interface ResumeDecision {
  ok: boolean;
  reason: string;
  mismatches: string[];
}

/** REQ-019: resume only when ALL four hashes match. */
export function assertResumable(cp: Checkpoint, current: CheckpointHashes): ResumeDecision {
  const mismatches: string[] = [];
  for (const key of ['workflowHash', 'configHash', 'adapterVersion', 'piVersion'] as const) {
    if (cp.hashes[key] !== current[key]) {
      mismatches.push(`${key}: checkpoint=${cp.hashes[key]} current=${current[key]}`);
    }
  }
  if (mismatches.length) {
    return { ok: false, reason: `resume refused: ${mismatches.length} hash mismatch(es)`, mismatches };
  }
  return { ok: true, reason: 'compatible: all hashes match', mismatches: [] };
}

/**
 * REQ-020: decide whether a side-effecting node should run again on resume.
 * If the node already has a recorded 'ok' result, skip it (the effect happened once).
 */
export function shouldRunSideEffectNode(state: RunState, node: string): boolean {
  const prior = state.results[node];
  return !(prior && prior.status === 'ok');
}
