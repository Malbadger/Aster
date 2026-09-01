import type { ProviderConnection } from '@law/contracts';

export interface CustomProviderSpecLike {
  id: string;
  name: string;
  baseUrl: string;
  api: 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai';
  locality: 'local' | 'any';
  apiKeyReference?: string;
  authHeader: boolean;
  headers?: Record<string, string>;
  models: Array<{ id: string; name?: string; reasoning?: boolean; vision?: boolean; contextWindow?: number; maxTokens?: number }>;
}

/** Convert persisted secret-free connection metadata into Pi's public config shape. */
export function toCustomProviderSpec(connection: ProviderConnection): CustomProviderSpecLike | undefined {
  if (!connection.enabled || !connection.endpoint) return undefined;
  const reference = connection.referenceHint?.trim();
  const apiKeyReference = connection.authMethod === 'none-local'
    ? 'aster-local-no-auth'
    : connection.authMethod === 'external-command' && reference
      ? (reference.startsWith('!') ? reference : `!${reference}`)
      : connection.authMethod === 'env-var' && reference
        ? reference
        : undefined;
  const headers = Object.fromEntries(connection.endpoint.headers.map((header) => [header.name, header.valueReference]));
  return {
    id: connection.provider,
    name: connection.label,
    baseUrl: connection.endpoint.baseUrl,
    api: connection.endpoint.api,
    locality: connection.locality === 'local' ? 'local' : 'any',
    ...(apiKeyReference ? { apiKeyReference } : {}),
    authHeader: connection.endpoint.authHeader,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    models: connection.endpoint.models,
  };
}

export function customProviderSpecs(connections: readonly ProviderConnection[]): CustomProviderSpecLike[] {
  return connections.map(toCustomProviderSpec).filter((value): value is CustomProviderSpecLike => Boolean(value));
}

