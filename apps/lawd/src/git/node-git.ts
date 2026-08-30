import { execFile } from "node:child_process";
import type { GitPort, GitRunResult } from "./git-service.js";

/** Real Git port: runs `git` with an argument array (no shell) in the repo cwd. */
export class NodeGit implements GitPort {
  constructor(private cwd: string) {}
  setCwd(path: string): void { this.cwd = path; }
  run(args: string[]): Promise<GitRunResult> {
    return new Promise((resolve) => {
      execFile("git", args, { cwd: this.cwd, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: number }).code === "number" ? (err as { code: number }).code : err ? 1 : 0;
        resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
      });
    });
  }
}
