import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface GeminiCliStatus {
  installed: boolean;
  configured: boolean;
  version?: string;
  authType?: string;
}

export class GeminiCliService {
  readonly cliPath: string;
  constructor(lawRoot: string, private readonly home = homedir()) {
    this.cliPath = join(lawRoot, 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js');
  }

  async status(): Promise<GeminiCliStatus> {
    if (!existsSync(this.cliPath)) return { installed: false, configured: false };
    const authType = this.selectedAuthType();
    let version: string | undefined;
    try {
      version = (await exec(process.execPath, [this.cliPath, '--version'], { timeout: 8_000 })).stdout.trim();
    } catch {
      // Installation is still reportable when version probing fails.
    }
    return {
      installed: true,
      configured: authType === 'oauth-personal' || authType === 'login-with-google',
      ...(version ? { version } : {}),
      ...(authType ? { authType } : {}),
    };
  }

  private selectedAuthType(): string | undefined {
    const path = join(this.home, '.gemini', 'settings.json');
    if (!existsSync(path)) return undefined;
    try {
      const settings = JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>;
      const raw = settings.security?.auth?.selectedType ?? settings.selectedAuthType;
      return typeof raw === 'string' ? raw.toLowerCase() : undefined;
    } catch {
      return undefined;
    }
  }
}

