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
  antigravityInstalled?: boolean;
  antigravityConfigured?: boolean;
  antigravityVersion?: string;
  migrationRequired?: boolean;
  models?: Array<{ id: string; name: string }>;
}

export class GeminiCliService {
  readonly cliPath: string;
  readonly antigravityPath: string;
  constructor(lawRoot: string, private readonly home = homedir()) {
    this.cliPath = join(lawRoot, 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js');
    const userLocal = join(home, '.local', 'bin', 'agy');
    this.antigravityPath = [userLocal, '/usr/local/bin/agy', '/usr/bin/agy'].find(existsSync) ?? userLocal;
  }

  async status(): Promise<GeminiCliStatus> {
    const legacyInstalled = existsSync(this.cliPath);
    const authType = this.selectedAuthType();
    let version: string | undefined;
    if (legacyInstalled) try {
      version = (await exec(process.execPath, [this.cliPath, '--version'], { timeout: 8_000 })).stdout.trim();
    } catch {
      // Installation is still reportable when version probing fails.
    }
    let antigravityInstalled = existsSync(this.antigravityPath);
    let antigravityVersion: string | undefined;
    let models: Array<{ id: string; name: string }> = [];
    if (antigravityInstalled) {
      try { antigravityVersion = (await exec(this.antigravityPath, ['--version'], { timeout: 8_000 })).stdout.trim(); } catch { /* status remains installed */ }
      try {
        const listing = (await exec(this.antigravityPath, ['models'], { timeout: 15_000 })).stdout;
        models = listing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
          const [id, ...label] = line.split(/\s+/); return { id: id!, name: label.join(' ') || id! };
        });
      } catch { /* installed but not yet signed in */ }
    }
    const legacyConfigured = Boolean(authType && !['oauth-personal', 'login-with-google'].includes(authType));
    const antigravityConfigured = models.length > 0;
    return {
      installed: antigravityInstalled || legacyInstalled,
      configured: antigravityConfigured || legacyConfigured,
      ...(version ? { version } : {}),
      ...(authType ? { authType } : {}),
      antigravityInstalled,
      antigravityConfigured,
      ...(antigravityVersion ? { antigravityVersion } : {}),
      migrationRequired: Boolean(authType && ['oauth-personal', 'login-with-google'].includes(authType) && !antigravityConfigured),
      models,
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
