import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createAdapterEvidence } from '../../apps/poolday/host/adapter-evidence.js';
import { adapter as fixtureAdapter, baseModel as fixtureBase, fixtureReceipt, json } from '../fixtures/adapter-evaluation.js';

const sha = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const base = { id: 'base', identity: sha('base') };
const entry = (id, evaluation, baseModelIdentity = base.identity) => ({ id, identity: sha(id), baseModelIdentity, evaluation });
const files = { '/config/adapter-evaluations/spec.json': '{"schema":"other"}', '/config/adapter-evaluations/receipt.json': '{}' };
const fetchImpl = async url => files[url] === undefined ? { ok: false, status: 404 }
  : { ok: true, arrayBuffer: async () => new TextEncoder().encode(files[url]).buffer };
const pin = url => ({ url, sha256: sha(files[url] ?? 'missing') });

describe('catalog adapter evaluation evidence', () => {
  it('labels nothing evaluated without a verified passing receipt', async () => {
    const evidence = createAdapterEvidence({ fetchImpl, models: [{ ...base, availableAdapters: [
      entry('none', null),
      entry('declared-but-invalid', { spec: pin('/config/adapter-evaluations/spec.json'), receipt: pin('/config/adapter-evaluations/receipt.json') }),
      entry('wrong-bytes', { spec: { ...pin('/config/adapter-evaluations/spec.json'), sha256: sha('other') }, receipt: pin('/config/adapter-evaluations/receipt.json') }),
      entry('missing-file', { spec: pin('/config/adapter-evaluations/spec.json'), receipt: pin('/config/adapter-evaluations/absent.json') }),
      entry('remote-url', { spec: { url: 'https://example.invalid/spec.json', sha256: sha('x') }, receipt: pin('/config/adapter-evaluations/receipt.json') }),
      entry('other-base', null, sha('other base'))
    ] }] });
    expect(evidence.snapshot()[sha('declared-but-invalid')].status).toBe('checking');
    await evidence.ready;
    const state = evidence.snapshot();
    expect(state[sha('none')]).toEqual({ status: 'none' });
    expect(state[sha('declared-but-invalid')]).toMatchObject({ status: 'invalid', reason: expect.stringContaining('spec.schema') });
    expect(state[sha('wrong-bytes')]).toMatchObject({ status: 'invalid', reason: expect.stringContaining('differs from its declared sha256') });
    expect(state[sha('missing-file')]).toMatchObject({ status: 'unavailable' });
    expect(state[sha('remote-url')]).toMatchObject({ status: 'invalid', reason: 'Evaluation must name a pinned spec and receipt' });
    // An adapter declaring a different base artifact is not this model's adapter at all.
    expect(state[sha('other-base')]).toBeUndefined();
    expect(Object.values(state).some(value => value.status === 'passed')).toBe(false);
  });

  it('labels an adapter passed only after its pinned receipt verifies against the exact catalog identities', async () => {
    for (const candidateCorrect of [true, false]) {
      const { spec, receipt } = await fixtureReceipt({ candidateCorrect });
      const served = { '/config/adapter-evaluations/fixture-spec.json': json(spec), '/config/adapter-evaluations/receipts/fixture.json': json(receipt) };
      const pinned = url => ({ url, sha256: sha(served[url]) });
      const evidence = createAdapterEvidence({ fetchImpl: async url => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode(served[url]).buffer }),
        models: [{ ...fixtureBase, availableAdapters: [{ ...fixtureAdapter, evaluation: { spec: pinned('/config/adapter-evaluations/fixture-spec.json'),
          receipt: pinned('/config/adapter-evaluations/receipts/fixture.json') } }] }] });
      await evidence.ready;
      expect(evidence.snapshot()[fixtureAdapter.identity]).toMatchObject({ status: candidateCorrect ? 'passed' : 'failed',
        receiptUrl: '/config/adapter-evaluations/receipts/fixture.json', specId: 'fixture/v1' });
    }
  });
});
