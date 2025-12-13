import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // GPU tests need sequential execution
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'results/html' }],
    ['json', { outputFile: 'results/report.json' }],
    ['list'],
  ],

  timeout: 120000, // GPU tests can be slow
  expect: {
    timeout: 30000,
  },

  use: {
    baseURL: 'http://localhost:8080/kernel-tests/browser',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',

    // WebGPU requires specific flags
    launchOptions: {
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--use-angle=vulkan',
      ],
    },
  },

  projects: [
    {
      name: 'chromium-webgpu',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
  ],

  webServer: {
    // Serve from parent dir so we can access both kernel-tests/ and reploid/
    command: 'python3 -m http.server 8080 --directory ..',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
});
