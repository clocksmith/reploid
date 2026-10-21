import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: './e2e', testMatch: 'first-visitor.spec.js', workers: 1, timeout: 45000,
  outputDir: '../test-results/first-visitor', reporter: 'list',
  use: { browserName: 'chromium', baseURL: 'http://127.0.0.1:8769', screenshot: 'only-on-failure' },
  webServer: { command: 'python3 -m http.server 8769 --bind 127.0.0.1 --directory self',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: 'http://127.0.0.1:8769', reuseExistingServer: false }
});
