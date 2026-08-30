import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getSelectedModel,
  listOllamaModels,
  selectOllamaModel,
} from '../../src/mcp/local-service.js';

function ollamaResponse(models: unknown[]): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ models }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

describe('local MCP service', () => {
  it('normalizes and sorts models returned by local Ollama', async () => {
    const models = await listOllamaModels(
      ollamaResponse([
        { name: 'zeta:latest', size: 2 },
        {
          name: 'alpha:latest',
          size: 1,
          details: { family: 'qwen', parameter_size: '7B', quantization_level: 'Q4_K_M' },
        },
      ]),
    );
    expect(models.map((model) => model.name)).toEqual(['alpha:latest', 'zeta:latest']);
    expect(models[0]?.family).toBe('qwen');
  });

  it('persists only a validated local model selection', async () => {
    const root = mkdtempSync(join(tmpdir(), 'law-mcp-'));
    const fetcher = ollamaResponse([{ name: 'qwen:latest', size: 1 }]);
    await expect(selectOllamaModel(root, 'missing:latest', fetcher)).rejects.toThrow(
      /not installed/,
    );
    const selected = await selectOllamaModel(root, 'qwen:latest', fetcher);
    expect(getSelectedModel(root)?.model).toBe('qwen:latest');
    expect(readFileSync(join(root, '.law', 'mcp-selection.json'), 'utf8')).not.toMatch(
      /token|password|secret/i,
    );
    expect(selected.model).toBe('qwen:latest');
  });
});
