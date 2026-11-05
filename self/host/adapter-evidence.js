/** Each catalog adapter's evaluation evidence, verified before anything may label it evaluated.
 * A catalog entry may declare a spec and a receipt, each by same-origin path and sha256. The bytes are
 * fetched, hash-checked and recomputed by the shared verifier; only a passing result is 'passed'.
 * Statuses: none (nothing declared), checking, passed, failed, invalid (wrong bytes, binding or arithmetic),
 * unavailable (the files could not be read). A declaration alone never changes the label. */
import { verifyAdapterEvaluationReceipt } from '../pool/adapter-evaluation.js';
import { compatibleAdapters } from './chat-view.js';

const PATH = /^\/config\/adapter-evaluations\/[a-z0-9][a-z0-9._/-]*\.json$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const pinned = value => value && typeof value.url === 'string' && PATH.test(value.url) && !value.url.includes('..') && SHA256.test(value.sha256);
const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');

export function createAdapterEvidence({ models, fetchImpl = globalThis.fetch?.bind(globalThis), onChange = () => {} }) {
  const results = new Map();
  let closed = false;
  const set = (identity, value) => { if (closed) return; results.set(identity, Object.freeze(value)); onChange(); };
  const read = async ({ url, sha256 }) => {
    const response = await fetchImpl(url);
    if (!response.ok) throw Object.assign(new Error(`${url} returned HTTP ${response.status}`), { unavailable: true });
    const bytes = await response.arrayBuffer();
    if ('sha256:' + hex(await globalThis.crypto.subtle.digest('SHA-256', bytes)) !== sha256) throw new Error(`${url} differs from its declared sha256`);
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  const checks = [];
  for (const baseModel of models || []) for (const adapter of compatibleAdapters(baseModel)) {
    const declared = adapter.evaluation;
    if (declared === null || declared === undefined) { results.set(adapter.identity, Object.freeze({ status: 'none' })); continue; }
    const receiptUrl = pinned(declared.receipt) ? declared.receipt.url : null;
    if (!pinned(declared.spec) || !receiptUrl) {
      results.set(adapter.identity, Object.freeze({ status: 'invalid', receiptUrl, reason: 'Evaluation must name a pinned spec and receipt' }));
      continue;
    }
    results.set(adapter.identity, Object.freeze({ status: 'checking', receiptUrl }));
    checks.push(Promise.resolve().then(async () => {
      if (typeof fetchImpl !== 'function') throw Object.assign(new Error('Evidence files cannot be read here'), { unavailable: true });
      const [spec, receipt] = await Promise.all([read(declared.spec), read(declared.receipt)]);
      const result = await verifyAdapterEvaluationReceipt({ receipt, spec, specSha256: declared.spec.sha256, adapter, baseModel });
      set(adapter.identity, { status: result.verdict, receiptUrl, specId: spec.id, task: spec.task.description,
        metrics: result.metrics, failures: result.failures });
    }).catch(error => set(adapter.identity, { status: error.unavailable ? 'unavailable' : 'invalid', receiptUrl, reason: error.message })));
  }
  return Object.freeze({
    /** Settles once every declared receipt has been checked. */
    ready: Promise.all(checks).then(() => undefined),
    snapshot: () => Object.fromEntries([...results].map(([identity, value]) => [identity, structuredClone(value)])),
    close() { closed = true; }
  });
}
