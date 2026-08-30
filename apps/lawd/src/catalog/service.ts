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
    const ordered = orderModels(descriptors, favorites, recent);
    const models = filterModels(ordered, query);
    return { models, favorites, recent };
  }

  setFavorite(modelId: string, favorite: boolean): { favorites: string[] } {
    return { favorites: this.prefs.setFavorite(modelId, favorite) };
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
