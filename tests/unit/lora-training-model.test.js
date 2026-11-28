import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import policy from '../../apps/poolday/config/lora-training.json';
import catalog from '../../shared/config/chat-models.json';
import hosting from '../../firebase.json';
import { resolveServedFile } from '../../server/browser-roots.js';
import { parseManifest } from '../../shared/vendor/doppler/0.2.0/src/formats/rdrr/index.js';
import { computeCanonicalSha256 } from '../../shared/vendor/doppler/0.2.0/src/formats/canonical-hash.js';

it('serves the pinned trainer manifest over the same model shards as the renamed chat release', async () => {
  const redirects = hosting.hosting.flatMap(target => target.redirects || []);
  const target = route => redirects.find(row => row.source === route)?.destination;
  const manifestPath = target(policy.modelPath + 'manifest.json');
  const bytes = await readFile(resolveServedFile(manifestPath));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  expect(manifestPath).toBe('/config/model-manifests/' + sha256 + '.json');
  const parsed = parseManifest(bytes.toString());
  expect(parsed.modelId).toBe(policy.modelId);
  expect(computeCanonicalSha256(parsed)).toBe(policy.baseManifestHash);

  const current = catalog.find(row => row.supersedes?.some(previous => previous.identity === 'sha256:' + sha256));
  const assetRoot = new URL(current.source.baseUrl).pathname;
  expect(target(policy.modelPath + ':file')).toBe(assetRoot + ':file');
  const chatManifest = JSON.parse(await readFile(resolveServedFile(target(assetRoot + 'manifest.json')), 'utf8'));
  expect(chatManifest.shards).toEqual(JSON.parse(bytes).shards);
});
