export default {
  testDir: '../../tests/e2e',
  testMatch: 'canonical-chat-history.spec.js',
  workers: 1,
  timeout: 30000,
  outputDir: '/tmp/reploid-canonical-publication-browser-results',
  reporter: 'list',
  use: { browserName: 'chromium', headless: true, launchOptions: { args: ['--disable-gpu'] } }
};
