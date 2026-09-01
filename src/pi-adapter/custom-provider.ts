import { ModelRuntime } from '@earendil-works/pi-coding-agent';

export type CustomProviderApi =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai';

export interface CustomProviderSpec {
  id: string;
  name: string;
  baseUrl: string;
  api: CustomProviderApi;
  locality: 'local' | 'any';
  /** Pi config reference: ENV_NAME, !command, or a non-secret local sentinel. */
  apiKeyReference?: string;
  authHeader: boolean;
  headers?: Record<string, string>;
  models: Array<{
    id: string;
    name?: string;
    reasoning?: boolean;
    vision?: boolean;
    contextWindow?: number;
    maxTokens?: number;
  }>;
}

/** Register secret-free user endpoints through Pi's public provider API. */
export function registerCustomProviders(runtime: ModelRuntime, specs: readonly CustomProviderSpec[]): void {
  for (const spec of specs) {
    runtime.registerProvider(spec.id, {
      name: spec.name,
      baseUrl: spec.baseUrl,
      api: spec.api,
      ...(spec.apiKeyReference ? { apiKey: spec.apiKeyReference } : {}),
      authHeader: spec.authHeader,
      ...(spec.headers && Object.keys(spec.headers).length > 0 ? { headers: spec.headers } : {}),
      models: spec.models.map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        reasoning: model.reasoning ?? false,
        input: model.vision ? ['text', 'image'] : ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: model.contextWindow ?? 128_000,
        maxTokens: model.maxTokens ?? 16_384,
      })),
    });
  }
}

