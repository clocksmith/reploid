import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const selfRoot = resolve('self');

export default defineConfig({
  resolve: {
    alias: [
      // Tests import ../../core/ etc. which resolves to <root>/core/
      // while the browser tree now lives under <root>/self/.
      { find: /^(\.\.\/)+(?=(core|infrastructure|capabilities|testing|tools|ui)\/)/, replacement: selfRoot + '/' },
    ]
  },
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'happy-dom',
    globals: true,
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
