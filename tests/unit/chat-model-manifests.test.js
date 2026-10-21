import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { buildHostingFileSet } from '../../scripts/hosting-file-set.js';

describe('chat model manifest delivery', () => {
  it('ships every pinned manifest in the ordinary browser bundle with unchanged bytes', async () => {
    const selfDir = resolve('self');
    const models = JSON.parse(await readFile(resolve(selfDir, 'config/chat-models.json')));
    const hosted = new Set(await buildHostingFileSet({ selfDir }));
    for (const model of models) {
      const file = model.source.files.find(item => item.role === 'model-manifest');
      const relative = `config/model-manifests/${file.hash}.json`;
      expect(file.url).toBe(`/${relative}`);
      expect(hosted.has(relative)).toBe(true);
      const bytes = await readFile(resolve(selfDir, relative));
      expect(bytes.length).toBe(file.sizeBytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.hash);
      expect(model.identity).toBe(`sha256:${file.hash}`);
      const manifest = JSON.parse(bytes);
      expect(manifest.modelId).toBe(model.id);
      const pieces = model.source.files.find(item => item.role === 'model-piece-index');
      const indexBytes = await readFile(resolve(selfDir, pieces.url.slice(1)));
      expect(hosted.has(pieces.url.slice(1))).toBe(true);
      expect(indexBytes.length).toBe(pieces.sizeBytes);
      expect(createHash('sha256').update(indexBytes).digest('hex')).toBe(pieces.hash);
      const index = JSON.parse(indexBytes);
      expect(index.manifestIdentity, model.id + ' piece index must bind the admitted manifest').toBe(model.identity);
      for (const shard of manifest.shards) {
        expect(index.files.find(entry => entry.path === shard.filename)?.size).toBe(shard.size);
      }
    }
  });
  it('binds Doppler acquisition URLs to the shipped manifest and immutable weight origin', async () => {
    const models = JSON.parse(await readFile(resolve('self/config/chat-models.json')));
    const config = JSON.parse(await readFile(resolve('firebase.json')));
    const routes = config.hosting.find(item => item.target === 'reploid').redirects;
    for (const model of models.filter(model => model.source.baseUrl)) {
      const base = new URL(model.source.baseUrl);
      const manifest = model.source.files.find(file => file.role === 'model-manifest');
      const requestPath = new URL('manifest.json', base).pathname;
      const delivery = routes.find(route => route.source === requestPath);
      expect(delivery?.destination).toBe(manifest.url);
      const bytes = await readFile(resolve('self', delivery.destination.slice(1)));
      expect('sha256:' + createHash('sha256').update(bytes).digest('hex')).toBe(model.identity);
      const files = routes.find(route => route.source === base.pathname.slice(0, -1) + '/:file');
      expect(files?.destination).toMatch(/^https:\/\/huggingface\.co\/clocksmith\/rdrr\/resolve\/[a-f0-9]{40}\/models\//);
      expect(files.destination.endsWith('//:file')).toBe(false);
    }
  });

});
