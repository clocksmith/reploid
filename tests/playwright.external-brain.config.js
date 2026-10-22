import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.REPLOID_E2E_BASE_URL || 'http://127.0.0.1:8000';
const target = new URL(baseURL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
  throw new Error('External brain acceptance requires a loopback server');
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'external-brain.spec.js',
  outputDir: '../test-results/external-brain',
  workers: 1,
  timeout: 120000,
  expect: { timeout: 30000 },
  use: { baseURL, screenshot: 'only-on-failure' },
  webServer: process.env.REPLOID_E2E_SKIP_LOCAL_SERVER === '1' ? undefined : {
    command: 'npm start',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: baseURL,
    env: { ...process.env, PORT: target.port || '8000',
      REPLOID_EXTERNAL_BRAIN: 'true', REPLOID_SKIP_CLOUD_ACCESS_BUILD: 'true' },
    reuseExistingServer: false,
    timeout: 30000
  }
});
