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
  sdkAuthMode?: string;
  supportedAuthModes?: string[];
  adcAvailable?: boolean;
  gcloudInstalled?: boolean;
  cloudProjectAvailable?: boolean;
  cloudLocationAvailable?: boolean;
  geminiApiKeyAvailable?: boolean;
  vertexExpressKeyAvailable?: boolean;
}

export class GeminiCliService {
  readonly cliPath: string;
  readonly antigravityPath: string;
  readonly antigravityBridgePath: string;
  readonly antigravityPythonPath: string;
  readonly antigravityModulePath: string;
  constructor(private readonly lawRoot: string, private readonly home = homedir(), private readonly pythonPath = 'python3') {
    this.cliPath = join(lawRoot, 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js');
    const userLocal = join(home, '.local', 'bin', 'agy');
    this.antigravityPath = [userLocal, '/usr/local/bin/agy', '/usr/bin/agy'].find(existsSync) ?? userLocal;
    this.antigravityBridgePath = join(lawRoot, 'apps', 'lawd', 'python', 'antigravity_bridge.py');
    this.antigravityPythonPath = pythonPath;
    this.antigravityModulePath = process.env.ASTER_ANTIGRAVITY_PYTHONPATH ?? (existsSync(join(lawRoot, '..', 'python', 'google'))
      ? join(lawRoot, '..', 'python')
      : join(lawRoot, 'packaging', 'runtime', 'python'));
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
    let antigravityInstalled = false;
    let antigravityVersion: string | undefined;
    let models: Array<{ id: string; name: string }> = [];
    let sdkStatus: Record<string, any> = {};
    if (existsSync(this.antigravityBridgePath)) {
      try {
        const result = await exec(this.antigravityPythonPath, [this.antigravityBridgePath, 'status'], {
          timeout: 12_000,
          env: { ...process.env, PYTHONPATH: [this.antigravityModulePath, process.env.PYTHONPATH].filter(Boolean).join(':') },
        });
        sdkStatus = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1) ?? '{}');
        antigravityInstalled = Boolean(sdkStatus.installed);
        antigravityVersion = typeof sdkStatus.version === 'string' ? sdkStatus.version : undefined;
        if (typeof sdkStatus.defaultModel === 'string') models = [{ id: sdkStatus.defaultModel, name: sdkStatus.defaultModel }];
      } catch { /* bridge or SDK unavailable */ }
    }
    const legacyConfigured = Boolean(authType && !['oauth-personal', 'login-with-google'].includes(authType));
    const antigravityConfigured = Boolean(sdkStatus.configured);
    return {
      installed: antigravityInstalled || legacyInstalled,
      configured: antigravityConfigured || legacyConfigured,
      ...(version ? { version } : {}),
      ...(authType ? { authType } : {}),
      antigravityInstalled,
      antigravityConfigured,
      ...(antigravityVersion ? { antigravityVersion } : {}),
      migrationRequired: Boolean(authType && ['oauth-personal', 'login-with-google'].includes(authType)),
      models,
      sdkAuthMode: typeof sdkStatus.authMode === 'string' ? sdkStatus.authMode : undefined,
      supportedAuthModes: Array.isArray(sdkStatus.supportedAuthModes) ? sdkStatus.supportedAuthModes : [],
      adcAvailable: Boolean(sdkStatus.adcAvailable),
      gcloudInstalled: await this.gcloudInstalled(),
      cloudProjectAvailable: Boolean(sdkStatus.cloudProjectAvailable),
      cloudLocationAvailable: Boolean(sdkStatus.cloudLocationAvailable),
      geminiApiKeyAvailable: Boolean(sdkStatus.geminiApiKeyAvailable),
      vertexExpressKeyAvailable: Boolean(sdkStatus.vertexExpressKeyAvailable),
    };
  }

  private async gcloudInstalled(): Promise<boolean> {
    try { await exec('gcloud', ['--version'], { timeout: 8_000 }); return true; }
    catch { return false; }
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
