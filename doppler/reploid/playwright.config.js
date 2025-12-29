/**
 * Playwright configuration for Reploid E2E tests
 */
import { defineConfig, devices } from '@playwright/test';

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
    baseURL: 'http://localhost:8000',
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
          args: [
            '--enable-unsafe-webgpu',
            '--enable-features=Vulkan',
            '--use-angle=vulkan',
            '--disable-gpu-sandbox',
          ],
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
  webServer: [
    {
      command: 'npm start',
      url: 'http://localhost:8000',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],

  // Increase timeout for model loading
  timeout: 300000, // 5 minutes
  expect: {
    timeout: 30000, // 30 seconds for assertions
  },
});
