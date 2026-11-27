/**
 * Browser checks of the Poolday interface that need no GPU: keyboard, focus and narrow screens.
 * Chromium runs headless with the GPU disabled and without WebGPU; the pages get a scripted
 * executor or no executor at all, so nothing here loads a model or opens a device.
 *
 *   npm run test:e2e:ui
 *
 * It serves this checkout on its own port (REPLOID_UI_E2E_PORT, default 8031) so it never reuses
 * another checkout's server on the usual 8000.
 */
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const port = process.env.REPLOID_UI_E2E_PORT || '8031';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e',
  // REPLOID_UI_E2E_SPECS runs other GPU-free journeys under the same browser (comma-separated file names).
  testMatch: process.env.REPLOID_UI_E2E_SPECS ? process.env.REPLOID_UI_E2E_SPECS.split(',') : ['ui-keyboard-viewport.spec.js'],
  outputDir: '../test-results/ui',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  timeout: 120000,
  expect: { timeout: 15000 },
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium-no-gpu', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--disable-gpu'] } } }],
  webServer: {
    command: 'npm start',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: baseURL,
    env: { ...process.env, PORT: port, POOL_ALLOW_UNAUTHENTICATED_LOCAL: 'true', REPLOID_SKIP_CLOUD_ACCESS_BUILD: 'true' },
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
