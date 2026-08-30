/**
 * System services (BUILD-D-018/019/021). Update checks (manual, checksummed, no
 * unsigned auto-apply — OPEN-D-003), transactional migrations with rollback,
 * the plugin compatibility/least-privilege contract, and honest About/limits.
 */
import type { PluginManifest, PluginState, UpdateInfo } from "@law/contracts";

// ---- Updates ----
export interface ReleaseProvider {
  /** Fetch latest release metadata, or throw when offline. */
  latest(): UpdateInfo | null;
}

export class UpdateService {
  constructor(
    private readonly currentVersion: string,
    private readonly release: ReleaseProvider,
    private readonly stageMarker: (version: string) => void = () => {},
  ) {}

  check(): { available: boolean; info?: UpdateInfo; reason?: string } {
    let info: UpdateInfo | null;
    try {
      info = this.release.latest();
    } catch {
      return { available: false, reason: "offline: could not reach release metadata" };
    }
    if (!info) return { available: false, reason: "no release metadata" };
    if (info.version === this.currentVersion) return { available: false, reason: "up to date" };
    return { available: true, info };
  }

  /** Stage a verified update WITHOUT replacing the running release. Never auto-applies. */
  stage(version: string): { staged: boolean; reason?: string } {
    let info: UpdateInfo | null;
    try {
      info = this.release.latest();
    } catch {
      return { staged: false, reason: "offline: cannot verify the release before staging" };
    }
    if (!info || info.version !== version) return { staged: false, reason: "requested version is not the current release" };
    if (!info.compatible) return { staged: false, reason: "release is not compatible with installed data schema" };
    this.stageMarker(version);
    // Unsigned releases can be staged for MANUAL verified install, but are never auto-applied.
    const reason = info.signaturePresent ? undefined : "unsigned release: manual verification required; will not auto-apply";
    return { staged: true, ...(reason ? { reason } : {}) };
  }
}

// ---- Migrations ----
export interface MigrationStore {
  getVersion(): number;
  setVersion(v: number): void;
  snapshot(): unknown;
  restore(snapshot: unknown): void;
}

export class MigrationService {
  constructor(
    private readonly store: MigrationStore,
    private readonly targetVersion: number,
    /** Apply the single step that migrates FROM version `v` to `v+1`; may throw. */
    private readonly applyStep: (v: number) => void,
  ) {}

  status(): { schemaVersion: number; targetVersion: number; pending: boolean } {
    const v = this.store.getVersion();
    return { schemaVersion: v, targetVersion: this.targetVersion, pending: v < this.targetVersion };
  }

  run(): { ok: boolean; from: number; to: number; rolledBack: boolean; reason?: string } {
    const from = this.store.getVersion();
    if (from >= this.targetVersion) return { ok: true, from, to: from, rolledBack: false };
    const snapshot = this.store.snapshot();
    try {
      for (let v = from; v < this.targetVersion; v += 1) {
        this.applyStep(v);
        this.store.setVersion(v + 1);
      }
      return { ok: true, from, to: this.targetVersion, rolledBack: false };
    } catch (err) {
      // Transactional: restore the pre-migration snapshot completely.
      this.store.restore(snapshot);
      this.store.setVersion(from);
      return { ok: false, from, to: from, rolledBack: true, reason: err instanceof Error ? err.message : "migration failed" };
    }
  }
}

// ---- Plugins ----
export class PluginService {
  constructor(
    private readonly apiVersion: number,
    private readonly allowedPermissions: string[],
  ) {}

  private evaluate(m: PluginManifest): PluginState {
    if (m.apiVersion !== this.apiVersion) {
      return { manifest: m, compatible: false, enabled: false, reason: `plugin API v${m.apiVersion} != host v${this.apiVersion}` };
    }
    const overreach = m.permissions.filter((p) => !this.allowedPermissions.includes(p));
    if (overreach.length > 0) {
      return { manifest: m, compatible: false, enabled: false, reason: `requests permissions outside least-privilege set: ${overreach.join(", ")}` };
    }
    return { manifest: m, compatible: true, enabled: true };
  }

  list(manifests: PluginManifest[]): { plugins: PluginState[]; apiVersion: number } {
    return { plugins: manifests.map((m) => this.evaluate(m)), apiVersion: this.apiVersion };
  }
}

// ---- About ----
export class AboutService {
  constructor(
    private readonly version: string,
    private readonly limits: () => string[],
    private readonly humanGates: () => string[],
  ) {}
  get(): { name: string; version: string; limitations: string[]; humanOnlyGates: string[] } {
    return { name: "LAW", version: this.version, limitations: this.limits(), humanOnlyGates: this.humanGates() };
  }
}
