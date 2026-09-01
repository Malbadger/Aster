import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { registerCustomProviders, type CustomProviderSpec } from './custom-provider.js';

/** Secret-free concrete models currently usable through Pi-owned auth. */
export interface AvailablePiModel {
  provider: string;
  id: string;
  name: string;
  reasoning: boolean;
  vision: boolean;
}

export async function listAvailablePiModels(customProviders: readonly CustomProviderSpec[] = []): Promise<AvailablePiModel[]> {
  const runtime = await ModelRuntime.create({ allowModelNetwork: false });
  registerCustomProviders(runtime, customProviders);
  const models = await runtime.getAvailable();
  return models.map((model) => ({
    provider: model.provider,
    id: model.id,
    name: model.name,
    reasoning: Boolean(model.reasoning),
    vision: model.input.includes('image'),
  }));
}
