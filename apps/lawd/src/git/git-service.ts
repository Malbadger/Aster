/**
 * Git service (BUILD-D-016). Runs Git through argument arrays (no shell string
 * interpolation). Local branch/stage/commit are direct; every REMOTE effect is
 * refused unless a confirmation scoped to the exact repository/remote/branch/
 * effect is supplied (RULE-D-007). No prompt text authorizes a remote effect.
 */
import type { GitStatus, RemoteConfirmation, RemoteEffect } from "@law/contracts";

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}
export interface GitPort {
  /** Run `git <args>` in the repository; args are passed as an array, never a shell string. */
  run(args: string[]): Promise<GitRunResult>;
}

export function parseStatus(porcelain: string): GitStatus {
  const lines = porcelain.split("\n").filter((l) => l.length > 0);
  let branch = "(detached)";
  let ahead = 0;
  let behind = 0;
  const files: GitStatus["files"] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      const head = line.slice(3);
      branch = head.split("...")[0]!.trim() || branch;
      ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0);
      behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0);
      continue;
    }
    const x = line[0];
    const y = line[1];
    const path = line.slice(3);
    if (x === "?" && y === "?") files.push({ path, state: "untracked" });
    else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) files.push({ path, state: "conflicted" });
    else if (x !== " " && x !== undefined) files.push({ path, state: "staged" });
    else files.push({ path, state: "unstaged" });
  }
  return { branch, ahead, behind, clean: files.length === 0, files };
}

export class GitService {
  constructor(
    private readonly git: GitPort,
    private repository: string,
  ) {}

  setRepository(path: string): void {
    this.repository = path;
    const mutable = this.git as GitPort & { setCwd?: (value: string) => void };
    mutable.setCwd?.(path);
  }

  async status(): Promise<{ status: GitStatus }> {
    const r = await this.git.run(["status", "--porcelain=v1", "-b"]);
    if (r.code !== 0) throw Object.assign(new Error(r.stderr || "git status failed"), { code: "INTERNAL" });
    return { status: parseStatus(r.stdout) };
  }

  async stage(paths: string[]): Promise<{ status: GitStatus }> {
    const r = await this.git.run(["add", "--", ...paths]);
    if (r.code !== 0) throw Object.assign(new Error(r.stderr || "git add failed"), { code: "INTERNAL" });
    return this.status();
  }

  async commit(message: string): Promise<{ commit: string; status: GitStatus }> {
    const c = await this.git.run(["commit", "-m", message]);
    if (c.code !== 0) throw Object.assign(new Error(c.stderr || "git commit failed"), { code: "CONFLICT" });
    const rev = await this.git.run(["rev-parse", "HEAD"]);
    const { status } = await this.status();
    return { commit: rev.stdout.trim(), status };
  }

  async createBranch(name: string): Promise<{ status: GitStatus }> {
    const r = await this.git.run(["checkout", "-b", name]);
    if (r.code !== 0) throw Object.assign(new Error(r.stderr || "git branch failed"), { code: "CONFLICT" });
    return this.status();
  }

  async remoteAction(input: {
    effect: RemoteEffect;
    remote: string;
    branch: string;
    confirmation?: RemoteConfirmation;
  }): Promise<{ performed: boolean; requiredConfirmation?: RemoteConfirmation; reason?: string }> {
    const required: RemoteConfirmation = {
      repository: this.repository,
      remote: input.remote,
      branch: input.branch,
      effect: input.effect,
    };
    const c = input.confirmation;
    const matches =
      c &&
      c.repository === required.repository &&
      c.remote === required.remote &&
      c.branch === required.branch &&
      c.effect === required.effect;
    if (!matches) {
      return {
        performed: false,
        requiredConfirmation: required,
        reason: `Remote ${input.effect} to ${input.remote}/${input.branch} requires explicit scoped confirmation (RULE-D-007). Data leaves this machine.`,
      };
    }

    switch (input.effect) {
      case "push":
        return this.performGit(["push", input.remote, input.branch]);
      case "force-push":
        return this.performGit(["push", "--force-with-lease", input.remote, input.branch]);
      case "delete-remote-branch":
        return this.performGit(["push", input.remote, "--delete", input.branch]);
      case "open-pr":
        return { performed: false, reason: "PR creation requires a host integration (e.g. gh); not enabled in this build." };
    }
  }

  private async performGit(args: string[]): Promise<{ performed: boolean; reason?: string }> {
    const r = await this.git.run(args);
    if (r.code !== 0) return { performed: false, reason: r.stderr || `git ${args[0]} failed` };
    return { performed: true };
  }
}
