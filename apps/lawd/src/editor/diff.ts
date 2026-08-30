/**
 * Minimal line-based diff + per-hunk apply for editable diffs (REQ-D-028).
 * Accepted hunks take the new side; pending/rejected hunks keep the old side, so
 * a reviewer can accept or reject file-by-file and hunk-by-hunk. Pure and
 * deterministic; the UI renders these hunks and Monaco provides the rich view.
 */
import type { Hunk, HunkStatus, Provenance } from "@law/contracts";

export interface InternalHunk {
  hunkId: string;
  oldStart: number;
  newStart: number;
  old: string[];
  new: string[];
  status: HunkStatus;
  provenance: Provenance;
}

function splitLines(text: string): string[] {
  return text.length === 0 ? [] : text.split("\n");
}

/** Longest-common-subsequence over lines. */
function lcs(a: string[], b: string[]): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  return dp;
}

type Op = { kind: "eq" | "del" | "ins"; line: string };

function diffOps(a: string[], b: string[]): Op[] {
  const dp = lcs(a, b);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: "eq", line: a[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ kind: "del", line: a[i]! });
      i += 1;
    } else {
      ops.push({ kind: "ins", line: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) ops.push({ kind: "del", line: a[i++]! });
  while (j < b.length) ops.push({ kind: "ins", line: b[j++]! });
  return ops;
}

export function buildHunks(oldText: string, newText: string, provenance: Provenance = "model"): InternalHunk[] {
  const ops = diffOps(splitLines(oldText), splitLines(newText));
  const hunks: InternalHunk[] = [];
  let oldLine = 1;
  let newLine = 1;
  let cur: InternalHunk | undefined;
  let n = 0;
  for (const op of ops) {
    if (op.kind === "eq") {
      cur = undefined;
      oldLine += 1;
      newLine += 1;
      continue;
    }
    if (!cur) {
      n += 1;
      cur = { hunkId: `h${n}`, oldStart: oldLine, newStart: newLine, old: [], new: [], status: "pending", provenance };
      hunks.push(cur);
    }
    if (op.kind === "del") {
      cur.old.push(op.line);
      oldLine += 1;
    } else {
      cur.new.push(op.line);
      newLine += 1;
    }
  }
  return hunks;
}

/** Rebuild content honoring each hunk's accept/reject decision. */
export function applyHunks(oldText: string, hunks: InternalHunk[]): string {
  const oldLines = splitLines(oldText);
  const out: string[] = [];
  let idx = 0; // 0-based pointer into oldLines
  const sorted = [...hunks].sort((a, b) => a.oldStart - b.oldStart);
  for (const h of sorted) {
    const start = h.oldStart - 1;
    while (idx < start) out.push(oldLines[idx++]!);
    if (h.status === "accepted") {
      out.push(...h.new);
    } else {
      out.push(...h.old);
    }
    idx += h.old.length;
  }
  while (idx < oldLines.length) out.push(oldLines[idx++]!);
  return out.join("\n");
}

export function toContractHunk(h: InternalHunk): Hunk {
  const lines = [...h.old.map((l) => `-${l}`), ...h.new.map((l) => `+${l}`)];
  return {
    hunkId: h.hunkId,
    oldStart: h.oldStart,
    oldLines: h.old.length,
    newStart: h.newStart,
    newLines: h.new.length,
    lines,
    status: h.status,
    provenance: h.provenance,
  };
}
