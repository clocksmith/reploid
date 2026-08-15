/**
 * Playwright configuration for Reploid E2E tests
 */
import { defineConfig, devices } from '@playwright/test';

const targetBaseUrl = process.env.REPLOID_E2E_BASE_URL || 'http://localhost:8000';
const targetUrl = new URL(targetBaseUrl);
const useLocalServer = targetUrl.hostname === 'localhost';
const localServerPort = targetUrl.port || '8000';
const skipLocalServer = process.env.REPLOID_E2E_SKIP_LOCAL_SERVER === '1';
const chromiumChannel = String(process.env.REPLOID_E2E_CHROMIUM_CHANNEL || '').trim();
const chromiumGpuArgs = process.platform === 'darwin'
  ? ['--enable-unsafe-webgpu']
  : [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--use-angle=vulkan',
      '--disable-gpu-sandbox',
    ];

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Run tests serially for GPU resource sharing
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Single worker for GPU tests
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/e2e-results.json' }]
  ],

  use: {
    baseURL: targetBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...(chromiumChannel ? { channel: chromiumChannel } : {}),
          args: chromiumGpuArgs,
        },
      },
    },
    // SwiftShader fallback for CI without GPU
    {
      name: 'chromium-swiftshader',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--enable-unsafe-webgpu',
            '--use-angle=swiftshader',
            '--disable-gpu-sandbox',
          ],
        },
      },
    },
  ],

  // Local dev server
  webServer: useLocalServer && !skipLocalServer ? [
    {
      command: 'npm start',
      url: targetBaseUrl,
      env: {
        ...process.env,
        PORT: localServerPort,
        POOL_ALLOW_UNAUTHENTICATED_LOCAL: process.env.POOL_ALLOW_UNAUTHENTICATED_LOCAL || 'true',
        REPLOID_SKIP_CLOUD_ACCESS_BUILD: 'true'
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ] : undefined,

  // Increase timeout for model loading
  timeout: 300000, // 5 minutes
  expect: {
    timeout: 30000, // 30 seconds for assertions
  },
});
