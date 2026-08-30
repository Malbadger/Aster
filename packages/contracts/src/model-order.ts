/**
 * Pure catalog ordering + effort resolution. No I/O, so both the daemon and
 * tests use the exact same logic.
 */
import { EFFORT_LEVELS, type EffortLevel, type EffortResolution, type ModelDescriptor } from "./model.js";

/**
 * RULE-D-001: order is favorites, then recent, then case-insensitive display
 * name. Provider is secondary. Duplicate display names get a disambiguating
 * secondary label (provider + locality) so names can stay primary.
 */
export function orderModels(
  models: ModelDescriptor[],
  favorites: readonly string[],
  recent: readonly string[],
): ModelDescriptor[] {
  const favSet = new Set(favorites);
  const recentIndex = new Map(recent.map((id, i) => [id, i]));

  const rank = (m: ModelDescriptor): number => {
    if (favSet.has(m.id)) return 0;
    if (recentIndex.has(m.id)) return 1;
    return 2;
  };

  const sorted = [...models].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) {
      // Within recent, preserve recency order (most-recent first).
      return (recentIndex.get(a.id)! - recentIndex.get(b.id)!);
    }
    const byName = a.displayName.toLocaleLowerCase().localeCompare(b.displayName.toLocaleLowerCase());
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });

  return applyDisambiguation(sorted);
}

/** Add secondaryLabel to any models whose display name is not unique. */
export function applyDisambiguation(models: ModelDescriptor[]): ModelDescriptor[] {
  const counts = new Map<string, number>();
  for (const m of models) {
    const key = m.displayName.toLocaleLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return models.map((m) => {
    const key = m.displayName.toLocaleLowerCase();
    if ((counts.get(key) ?? 0) > 1 && !m.secondaryLabel) {
      return { ...m, secondaryLabel: `${m.provider} · ${m.locality}` };
    }
    return m;
  });
}

/** Case-insensitive substring filter over display name, provider, and id. */
export function filterModels(models: ModelDescriptor[], query: string): ModelDescriptor[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return models;
  return models.filter(
    (m) =>
      m.displayName.toLocaleLowerCase().includes(q) ||
      m.provider.toLocaleLowerCase().includes(q) ||
      m.id.toLocaleLowerCase().includes(q),
  );
}

/**
 * RULE-D-002: the effective effort is the requested level mapped through the
 * model's adapter. An unsupported level is refused with a reason — never
 * silently ignored or downgraded.
 */
export function resolveEffort(model: ModelDescriptor, requested: EffortLevel): EffortResolution {
  const supported = model.effort.supported.includes(requested);
  if (supported) {
    return { modelId: model.id, requested, effective: requested, supported: true };
  }
  const available = model.effort.supported.length
    ? model.effort.supported.join(", ")
    : "none";
  return {
    modelId: model.id,
    requested,
    supported: false,
    reason: `"${requested}" is not supported by this model; it is refused, not silently ignored. Supported: ${available}.`,
  };
}

/** Ordinal index of an effort level (for UI ordering of the control). */
export function effortIndex(level: EffortLevel): number {
  return EFFORT_LEVELS.indexOf(level);
}
