import { configDefaults, defineConfig } from 'vitest/config';
import base, { heavyTests } from './vitest.config.js';

// Runs the named retained-artifact and process checks excluded from the default suite.
// The Smoke workflow runs focused contracts; this suite is explicit opt-in.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    reporters: process.env.CI ? ['default', ['json', { outputFile: 'test-results/vitest-heavy-results.json' }]] : ['default'],
    include: heavyTests,
    exclude: configDefaults.exclude
  }
});
