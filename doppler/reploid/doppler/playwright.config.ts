/**
 * Playwright Configuration for DOPPLER E2E Tests
 *
 * Defaults to headed mode because WebGPU requires a real GPU context.
 * Headless Chromium does not support WebGPU on most systems.
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',

  // Fail fast
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,

  // Reporter
  reporter: process.env.CI ? 'github' : 'list',

  // Global timeout
  timeout: 120000,

  use: {
    // Base URL for navigation
    baseURL: 'http://localhost:8080',

    // WebGPU requires headed mode - this is the key setting
    headless: false,

    // Collect trace on failure
    trace: 'on-first-retry',

    // Video on failure for debugging
    video: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Chrome/Chromium with WebGPU support
        launchOptions: {
          args: [
            '--enable-features=Vulkan',
            '--enable-unsafe-webgpu',
            '--enable-webgpu-developer-features',
          ],
        },
      },
    },
  ],

  // Development server
  webServer: {
    command: 'npx tsx serve.ts',
    url: 'http://localhost:8080',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
