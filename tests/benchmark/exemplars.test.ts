import { describe, expect, it } from 'vitest';
import { renderBenchmark, runRequiredExemplars } from '../../src/benchmark/index.js';
describe('controlled exemplars', () => {
  const results = runRequiredExemplars();
  for (const result of results) it(`${result.id} passes`, () => expect(result.pass).toBe(true));
  it('renders controlled sentinel', () =>
    expect(renderBenchmark(results, 'ollama')).toContain('BENCHMARK PASS'));
});
