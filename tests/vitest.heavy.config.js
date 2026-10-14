import { configDefaults, defineConfig } from 'vitest/config';
import base, { heavyTests } from './vitest.config.js';

// Runs only the files excluded from the default config. CI runs this after `npm test`.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    reporters: process.env.CI ? ['default', ['json', { outputFile: 'test-results/vitest-heavy-results.json' }]] : ['default'],
    include: heavyTests,
    exclude: configDefaults.exclude
  }
});
