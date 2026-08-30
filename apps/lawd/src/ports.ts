/**
 * Ports the daemon depends on. Keeping these as narrow interfaces lets the
 * daemon be tested deterministically (fakes) while the real implementations
 * bind to LAW Core and the host. The daemon owns policy; ports never widen it.
 */
import type { CapabilityProbe, ModelDescriptor } from "@law/contracts";

/** Injectable clock for deterministic tests. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/**
 * Capability probe port. The real implementation binds to LAW Core
 * (`createPiAdapter().capabilities()` + `buildDoctorReport`) and host probes
 * (Git, Ollama loopback, container engine). Read-only: never installs anything.
 */
export interface CapabilityProbePort {
  probe(refresh: boolean): Promise<CapabilityProbe>;
}

/**
 * Effective-policy port (seed). BUILD-D-011 fleshes this out; here it only
 * answers whether external (non-loopback) egress is currently blocked, which
 * the health snapshot reports as `offlineLocalOnly` (RULE-D-006).
 */
export interface PolicyPort {
  offlineLocalOnly(): boolean;
}

export const defaultPolicy: PolicyPort = {
  // Local-first default: external egress is off until a visible action enables it.
  offlineLocalOnly: () => true,
};

/**
 * Model source port. The real implementation binds to LAW Core
 * (`listOllamaModels` + `capabilities().providers`) and produces provider-neutral
 * descriptors. No model name is hard-coded (DEC-D-016, REQ-D-006).
 */
export interface ModelSourcePort {
  descriptors(): Promise<ModelDescriptor[]>;
}

/** Local preferences store for favorites and recent models (REQ-D-008). */
export interface PreferencesStore {
  getFavorites(): string[];
  setFavorite(modelId: string, favorite: boolean): string[];
  getRecent(): string[];
  addRecent(modelId: string): void;
}
