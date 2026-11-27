import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './deploy/cloudflare/wrangler.api.jsonc' },
    miniflare: {
      bindings: { MIGRATION_TOKEN: 'migration-test-token', REPLOID_RELEASE_SOURCE_REVISION: 'a'.repeat(40) },
      // Stands in for reploid-swarm's /rtc-config: echoes what the coordinator forwarded.
      serviceBindings: {
        SWARM(request) {
          return Response.json({ forwarded: { url: request.url, origin: request.headers.get('Origin'), authorization: request.headers.get('Authorization') } },
            { status: request.headers.get('Authorization') ? 200 : 401 });
        }
      }
    }
  })],
  test: { include: ['tests/cloudflare/api.spec.js'], testTimeout: 15000 }
});
