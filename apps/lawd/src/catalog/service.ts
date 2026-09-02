/**
 * Catalog service: composes a model source with local preferences to answer the
 * catalog/effort operations using the shared pure logic (RULE-D-001/002).
 */
import {
  filterModels,
  orderModels,
  resolveEffort,
  type EffortLevel,
  type EffortResolution,
  type ModelCatalog,
  type ModelTargetResolution,
} from "@law/contracts";
import type { ModelSourcePort, PreferencesStore } from "../ports.js";

export class CatalogService {
  constructor(
    private readonly source: ModelSourcePort,
    private readonly prefs: PreferencesStore,
  ) {}

  async listCatalog(query: string): Promise<ModelCatalog> {
    const descriptors = await this.source.descriptors();
    const favorites = this.prefs.getFavorites();
    const recent = this.prefs.getRecent();
    const defaults = this.prefs.getProviderDefaults();
    const ordered = orderModels(descriptors, favorites, recent);
    const models = filterModels(ordered, query);
    return { models, favorites, recent, defaults };
  }

  setFavorite(modelId: string, favorite: boolean): { favorites: string[] } {
    return { favorites: this.prefs.setFavorite(modelId, favorite) };
  }

  async setProviderDefault(provider: string, modelId?: string): Promise<{ defaults: Record<string, string> }> {
    if (modelId) {
      const resolution = await this.resolveTarget({ provider, modelId });
      if (resolution.model.availability !== "available") {
        throw new Error(`model "${modelId}" is not currently available`);
      }
    }
    return { defaults: this.prefs.setProviderDefault(provider, modelId) };
  }

  async resolveTarget(input: { provider?: string; modelId?: string }): Promise<ModelTargetResolution> {
    const descriptors = await this.source.descriptors();
    const source = input.modelId ? "explicit" as const : "provider-default" as const;
    const modelId = input.modelId ?? (input.provider ? this.prefs.getProviderDefaults()[input.provider] : undefined);
    if (!modelId) {
      if (!input.provider) throw new Error("provider or exact model is required");
      throw new Error(`no default model is configured for provider "${input.provider}"`);
    }
    const model = descriptors.find((entry) => entry.id === modelId);
    if (!model) throw new Error(`model "${modelId}" is not in the current catalog`);
    if (input.provider && model.provider !== input.provider) {
      throw new Error(`model "${modelId}" belongs to provider "${model.provider}", not "${input.provider}"`);
    }
    if (model.availability !== "available") {
      throw new Error(`model "${modelId}" is not currently available (${model.availability})`);
    }
    return { model, source };
  }

  async resolveEffort(modelId: string, effort: EffortLevel): Promise<EffortResolution> {
    const descriptors = await this.source.descriptors();
    const model = descriptors.find((m) => m.id === modelId);
    if (!model) {
      return {
        modelId,
        requested: effort,
        supported: false,
        reason: `model "${modelId}" is not in the current catalog`,
      };
    }
    return resolveEffort(model, effort);
  }
}
