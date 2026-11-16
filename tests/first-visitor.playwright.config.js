import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: './e2e', testMatch: 'first-visitor.spec.js', workers: 1, timeout: 45000,
  outputDir: '../test-results/first-visitor', reporter: 'list',
  use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:8769', screenshot: 'only-on-failure',
    channel: process.env.REPLOID_E2E_CHROMIUM_CHANNEL || undefined,
    launchOptions: { args: ['--disable-gpu'] } },
  webServer: { command: 'node tests/helpers/browser-tree-server.js 8769',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: 'http://127.0.0.1:8769', reuseExistingServer: false }
});
