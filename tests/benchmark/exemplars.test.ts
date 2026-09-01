import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderBenchmark, runRequiredExemplars } from '../../src/benchmark/index.js';

if (existsSync(join(process.cwd(), 'benchmarks', 'cases.json'))) {
  describe('controlled exemplars', () => {
    const results = runRequiredExemplars();
    for (const result of results) it(`${result.id} passes`, () => expect(result.pass).toBe(true));
    it('renders controlled sentinel', () =>
      expect(renderBenchmark(results, 'ollama')).toContain('BENCHMARK PASS'));
  });
} else {
  describe.skip('controlled exemplars (private corpus not distributed)', () => {
    it('requires benchmarks/cases.json', () => {});
  });
}
