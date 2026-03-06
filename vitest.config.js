import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

const src = resolve('src');

export default defineConfig({
  resolve: {
    alias: [
      // Tests import ../../core/ etc. which resolves to <root>/core/
      // but source lives under <root>/src/ — rewrite the ../ prefix to src/
      { find: /^(\.\.\/)+(?=(core|infrastructure|capabilities|testing|tools|ui)\/)/, replacement: src + '/' },
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
