import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mountProxyStorageRoutes } from '../../server/proxy-storage.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('proxy public surface', () => {
  it('mounts no unauthenticated console log routes', () => {
    const routes = [];
    const app = {
      get: (route, ...handlers) => routes.push({ method: 'get', route, handlers: handlers.length }),
      post: (route, ...handlers) => routes.push({ method: 'post', route, handlers: handlers.length })
    };
    const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'reploid-storage-'));
    mountProxyStorageRoutes(app, { rootDirectory, requireServerAccess: (req, res, next) => next() });
    expect(routes.some(({ route }) => String(route).includes('console-logs'))).toBe(false);
    // Every remaining storage route sits behind the access middleware.
    expect(routes.length).toBeGreaterThan(0);
    for (const { handlers } of routes) expect(handlers).toBe(2);
  });

  it('never puts the Gemini key in a request URL', () => {
    for (const file of ['server/proxy-providers.js', 'packages/functions/zero-gemini-handler.js']) {
      const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      expect(source).not.toMatch(/[?&]key=\$\{/);
    }
    expect(fs.readFileSync(path.join(repoRoot, 'server/proxy-app.js'), 'utf8')).toContain("'x-goog-api-key': GEMINI_API_KEY");
    expect(fs.readFileSync(path.join(repoRoot, 'packages/functions/zero-gemini-handler.js'), 'utf8')).toContain("'x-goog-api-key': key");
  });

  it('does not return raw exception messages from Gemini 502 paths', () => {
    for (const file of ['server/proxy-providers.js', 'packages/functions/zero-gemini-handler.js']) {
      const source = fs.readFileSync(path.join(repoRoot, file), 'utf8');
      expect(source).not.toMatch(/status\(502\)\.json\(\{\s*error:\s*error/);
    }
  });
});
