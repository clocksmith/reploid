// @vitest-environment node
// Model names in the catalog (Doppler docs/style/model-naming.md): lowercase letters, digits and single
// hyphens, ending with the suffix the manifest's own format record generates. The catalog is what
// `reploid models` prints and what a provider advertises, so a name that misdescribes its manifest is caught here.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import origins from '../../server/native-model-origins.json' with { type: 'json' };

const manifestOf = model => {
  const bytes = fs.readFileSync(new URL(`../../shared/config/model-manifests/${model.identity.slice(7)}.json`, import.meta.url));
  return { bytes, manifest: JSON.parse(bytes) };
};
// The tag a manifest stores keeps the format's own spelling (q4_0); a name writes it without the underscore.
const nameSuffix = tag => String(tag).toLowerCase().replace(/q(\d)_(\d)/g, 'q$1$2').replace(/[^a-z0-9-]/g, '-');
const tensorFormat = dtype => ({ q4_k_m: 'q4k', q5_k_m: 'q5k', q6_k: 'q6k' })[String(dtype).toLowerCase()] ?? String(dtype).toLowerCase();

describe('catalog model names', () => {
  it('uses lowercase letters, digits and single hyphens', () => {
    for (const model of catalog) expect(model.id, model.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('ends each name with the suffix its manifest generates, and the manifest carries the same name', () => {
    for (const model of catalog) {
      const { bytes, manifest } = manifestOf(model);
      expect('sha256:' + createHash('sha256').update(bytes).digest('hex'), model.id).toBe(model.identity);
      expect(manifest.modelId, model.id).toBe(model.id);
      expect(model.id.endsWith('-' + nameSuffix(manifest.quantizationInfo.variantTag)), `${model.id} against ${manifest.quantizationInfo.variantTag}`).toBe(true);
    }
  });

  it('records a format that matches the stored type of the embedding and head tensors', () => {
    for (const model of catalog) {
      const { manifest } = manifestOf(model), info = manifest.quantizationInfo;
      for (const [role, declared] of [['embedding', info.embeddings ?? info.weights], ['lm_head', info.lmHead ?? info.embeddings ?? info.weights]]) {
        const stored = new Set(Object.values(manifest.tensors ?? {}).filter(tensor => tensor.role === role).map(tensor => tensorFormat(tensor.dtype)));
        if (stored.size === 1) expect([...stored][0], `${model.id} ${role}`).toBe(tensorFormat(declared));
      }
    }
  });

  it('names what a reissued model replaced, with nothing left pointing at the earlier identity', () => {
    const ids = new Set(catalog.map(model => model.id)), identities = new Set(catalog.map(model => model.identity));
    for (const model of catalog) for (const row of model.supersedes ?? []) {
      expect(row.identity).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(ids.has(row.id) || identities.has(row.identity), `${model.id} supersedes a model still in the catalog`).toBe(false);
      // Rejoining after the rename: the earlier name must not have become a valid name of something else.
      expect(row.id).not.toBe(model.id);
    }
    // A split plan carries the model's name, and its ID is the hash of the plan.
    for (const model of catalog.filter(row => row.partitionPlan)) expect(model.partitionPlan.modelId, model.id).toBe(model.id);
    for (const [id, pin] of Object.entries(origins.origins)) {
      const model = catalog.find(row => row.id === id);
      expect(model?.identity, `origin pin ${id}`).toBe(pin.modelIdentity);
    }
  });

  it('keeps paths of the converting machine out of every manifest', () => {
    expect(catalog.every(row => row.supersedes?.length), 'every model was reissued under a conforming name').toBe(true);
    for (const model of catalog) {
      const text = manifestOf(model).bytes.toString('utf8');
      expect(text.match(/file:|\/home\/|\/run\/media|\/Users\/|~\//g) ?? [], model.id).toEqual([]);
    }
  });
});
