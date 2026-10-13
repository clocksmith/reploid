import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../tests/e2e', testMatch: ['first-use-preparation.spec.js', 'chat-material.spec.js'], workers: 1,
  timeout: 30000, expect: { timeout: 1500 }, reporter: [['list']],
  outputDir: '/var/tmp/reploid-first-use-preparation-results',
  use: { baseURL: 'http://127.0.0.1:29873', launchOptions: { args: ['--disable-gpu', '--disable-webgpu'] } },
  webServer: { command: 'node server/proxy.js', cwd: process.cwd(), url: 'http://127.0.0.1:29873/config/chat-files.json',
    env: { PORT: '29873', REPLOID_SKIP_CLOUD_ACCESS_BUILD: 'true', DECO_VISUAL_FEEDBACK: '0', AUTO_START_OLLAMA: 'false' },
    reuseExistingServer: false, timeout: 30000 }
});
