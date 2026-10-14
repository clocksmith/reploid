import { configDefaults, defineConfig } from 'vitest/config';
import { resolve } from 'path';

const selfRoot = resolve(import.meta.dirname, '../self');

// Kept out of the default run; `npm run test:heavy` (tests/vitest.heavy.config.js) runs them.
// Each one decompresses or hashes multi-megabyte retained archives, or starts node/npm/git child processes.
export const heavyTests = [
  'tests/unit/retained-document-search.test.js',
  'tests/unit/retained-document-assistant.test.js',
  'tests/unit/retained-peer-pack-episode.test.js',
  'tests/unit/distributed-reference-contract.test.js',
  'tests/integration/browser-snapshot-server.test.js',
  'tests/unit/cli-contract.test.js',
  'tests/unit/doppler-partition-delivery.test.js',
  'tests/unit/native-delivery.test.js',
  'tests/unit/native-ordered-config.test.js',
  'tests/unit/native-partition-endpoint.test.js',
  'tests/unit/native-room-token-file.test.js',
  'tests/unit/native-supply-budget.test.js'
];

export default defineConfig({
  root: resolve(import.meta.dirname, '..'),
  resolve: {
    alias: [
      // Tests import ../../core/ etc. which resolves to <root>/core/
      // while the browser tree now lives under <root>/self/.
      { find: /^(\.\.\/)+(?=(core|infrastructure|capabilities|testing|tools|ui)\/)/, replacement: selfRoot + '/' },
    ]
  },
  test: {
    reporters: process.env.CI ? ['default', 'github-actions', ['json', { outputFile: 'test-results/vitest-results.json' }]] : ['default'],
    include: ['tests/**/*.test.js'],
    exclude: [...configDefaults.exclude, ...heavyTests],
    environment: 'happy-dom',
    globals: true,
    // Hosted runners run the parallel suite slower; signed multi-peer tests need room there.
    testTimeout: process.env.CI ? 20000 : 5000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60
      }
    }
  }
});
