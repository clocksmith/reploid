import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './deploy/cloudflare/wrangler.jsonc' } })],
  test: { include: ['tests/cloudflare/swarm.spec.js'], testTimeout: 15000 }
});
