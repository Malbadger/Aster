/**
 * Editor service (BUILD-D-013/014). Owns workspace file reads/writes, content
 * hashing, provenance, and verification staleness. A PASS is bound to an exact
 * content hash; any write changes the hash and makes prior verification STALE
 * (RULE-D-004). Provenance records model/human/formatter/mixed authorship as
 * evidence, not an authorship-certainty claim. All paths are workspace-contained.
 */
import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type { FileState, Provenance, VerificationRun, VerificationResult } from "@law/contracts";

export interface FsPort {
  read(path: string): string;
  write(path: string, content: string): void;
  exists(path: string): boolean;
  list(path: string): Array<{ name: string; kind: "file" | "directory" | "symlink" }>;
}

/** Required-checks runner for a file's content. Deterministic in tests. */
export type Checker = (path: string, content: string) => { ok: boolean; commands: string[] };

export interface EditorDeps {
  workspaceRoot: string;
  fs: FsPort;
  checker?: Checker;
  now?: () => Date;
}

interface Tracked {
  contentHash: string;
  provenance: Provenance;
  verifiedHash?: string;
  lastResult?: "pass" | "fail";
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function combineProvenance(prev: Provenance, author: "human" | "model" | "formatter"): Provenance {
  if (prev === "none") return author;
  if (prev === author) return author;
  return "mixed";
}

export class EditorService {
  private root: string;
  private readonly now: () => Date;
  private readonly checker: Checker;
  private readonly tracked = new Map<string, Tracked>();

  constructor(private readonly deps: EditorDeps) {
    this.root = resolve(deps.workspaceRoot);
    this.now = deps.now ?? (() => new Date());
    this.checker = deps.checker ?? defaultChecker;
  }

  setWorkspaceRoot(path: string): void {
    this.root = resolve(path);
    this.tracked.clear();
  }

  private contain(path: string): string {
    const abs = isAbsolute(path) ? resolve(path) : resolve(this.root, path);
    if (abs !== this.root && !abs.startsWith(`${this.root}/`)) {
      throw Object.assign(new Error(`path "${path}" escapes the workspace`), { code: "POLICY_DENIED" });
    }
    return abs;
  }

  private stateFor(path: string, t: Tracked): FileState {
    let verification: VerificationResult;
    if (!t.verifiedHash) verification = "unverified";
    else if (t.verifiedHash !== t.contentHash) verification = "stale";
    else verification = t.lastResult === "fail" ? "fail" : "pass";
    return {
      path,
      contentHash: t.contentHash,
      provenance: t.provenance,
      verification,
      ...(t.verifiedHash ? { verifiedHash: t.verifiedHash } : {}),
    };
  }

  readFile(path: string): { path: string; content: string; state: FileState } {
    const abs = this.contain(path);
    if (!this.deps.fs.exists(abs)) {
      throw Object.assign(new Error(`no such file: ${path}`), { code: "NOT_FOUND" });
    }
    const content = this.deps.fs.read(abs);
    const hash = hashContent(content);
    const prev = this.tracked.get(abs);
    const t: Tracked = prev ?? { contentHash: hash, provenance: "none" };
    if (t.contentHash !== hash) t.contentHash = hash; // external change resets nothing but the hash
    this.tracked.set(abs, t);
    return { path, content, state: this.stateFor(path, t) };
  }

  listDirectory(path: string): { path: string; entries: Array<{ name: string; path: string; kind: "file" | "directory" | "symlink" }> } {
    const abs = this.contain(path);
    if (!this.deps.fs.exists(abs)) {
      throw Object.assign(new Error(`no such directory: ${path}`), { code: "NOT_FOUND" });
    }
    const entries = this.deps.fs.list(abs)
      .map((entry) => ({ ...entry, path: resolve(abs, entry.name) }))
      .sort((left, right) => {
        if (left.kind === "directory" && right.kind !== "directory") return -1;
        if (left.kind !== "directory" && right.kind === "directory") return 1;
        return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
      });
    return { path: abs, entries };
  }

  writeFile(path: string, content: string, author: "human" | "model" | "formatter"): { state: FileState } {
    const abs = this.contain(path);
    this.deps.fs.write(abs, content);
    const hash = hashContent(content);
    const prev = this.tracked.get(abs);
    const provenance = combineProvenance(prev?.provenance ?? "none", author);
    // The write changes the hash; prior verification (bound to the old hash) is now stale.
    const t: Tracked = {
      contentHash: hash,
      provenance,
      ...(prev?.verifiedHash ? { verifiedHash: prev.verifiedHash } : {}),
      ...(prev?.lastResult ? { lastResult: prev.lastResult } : {}),
    };
    this.tracked.set(abs, t);
    return { state: this.stateFor(path, t) };
  }

  verifyRun(path: string): { run: VerificationRun; state: FileState } {
    const abs = this.contain(path);
    const content = this.deps.fs.read(abs);
    const hash = hashContent(content);
    const { ok, commands } = this.checker(path, content);
    const prev = this.tracked.get(abs) ?? { contentHash: hash, provenance: "none" as Provenance };
    const t: Tracked = { ...prev, contentHash: hash, verifiedHash: hash, lastResult: ok ? "pass" : "fail" };
    this.tracked.set(abs, t);
    const run: VerificationRun = {
      verificationId: `ver-${hash.slice(0, 12)}`,
      path,
      changeHash: hash,
      commands,
      result: ok ? "pass" : "fail",
      at: this.now().toISOString(),
    };
    return { run, state: this.stateFor(path, t) };
  }

  status(path: string): { state: FileState } {
    const abs = this.contain(path);
    const t = this.tracked.get(abs);
    if (!t) {
      if (!this.deps.fs.exists(abs)) throw Object.assign(new Error(`no such file: ${path}`), { code: "NOT_FOUND" });
      const hash = hashContent(this.deps.fs.read(abs));
      const fresh: Tracked = { contentHash: hash, provenance: "none" };
      this.tracked.set(abs, fresh);
      return { state: this.stateFor(path, fresh) };
    }
    return { state: this.stateFor(path, t) };
  }
}

/** Default checker: a conservative syntax sanity check for JSON; otherwise pass. */
function defaultChecker(path: string, content: string): { ok: boolean; commands: string[] } {
  if (path.endsWith(".json")) {
    try {
      JSON.parse(content);
      return { ok: true, commands: ["json.parse"] };
    } catch {
      return { ok: false, commands: ["json.parse"] };
    }
  }
  // Balanced-bracket heuristic for brace languages; real language servers wire in on Ubuntu.
  const opens = (content.match(/[([{]/g) ?? []).length;
  const closes = (content.match(/[)\]}]/g) ?? []).length;
  return { ok: opens === closes, commands: ["bracket-balance"] };
}
