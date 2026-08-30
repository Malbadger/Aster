import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

export interface GitProbe {
  available: boolean;
  version?: string;
  detail: string;
}

/** Detect the Git CLI. Read-only; runs `git --version` with a short timeout. */
export async function detectGit(timeoutMs = 4000): Promise<GitProbe> {
  try {
    const { stdout } = await pExecFile("git", ["--version"], { timeout: timeoutMs });
    const version = stdout.trim().replace(/^git version\s*/i, "");
    return { available: true, version, detail: stdout.trim() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { available: false, detail: `git not found: ${msg.split("\n")[0]}` };
  }
}
