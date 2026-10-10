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
      expect(JSON.parse(bytes).modelId).toBe(model.id);
    }
  });
});
