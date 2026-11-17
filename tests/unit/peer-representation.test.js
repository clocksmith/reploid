// @vitest-environment node
import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { inspectPeerRepresentation, requirePeerRepresentation } from '../fixtures/peers/pooled/representation.js';
import { createQ5Converter } from '../fixtures/peers/pooled/q5-converter.js';

const config = { inference: { session: { compute: { defaults: Object.fromEntries(
  ['activationDtype', 'mathDtype', 'accumDtype', 'outputDtype'].map(key => [key, 'f32'])) } } } };
it('refuses raw Q5 shared matrices despite a Q8 profile label and admits explicit Q8 replacements', () => {
  const manifest = { modelId: 'test', metadata: { sourceRuntime: { sourceKind: 'gguf' } },
    tensors: { shared: { dtype: 'Q5_0', shape: [32, 32] }, float: { dtype: 'BF16', shape: [32, 32] } } };
  expect(inspectPeerRepresentation(manifest, config).mismatches).toEqual([expect.objectContaining({ name: 'shared', peerDtype: 'Q8_0' })]);
  expect(() => requirePeerRepresentation(manifest, config)).toThrow('refuse model comparison');
  manifest.tensors.shared.dtype = 'Q8_0';
  expect(requirePeerRepresentation(manifest, config).ready).toBe(true);
});

it('rejects a KV runtime/kernel contract mismatch before GPU loading and exposes cache precision differences', () => {
  const manifest = { modelId: 'kv-contract', metadata: { sourceRuntime: { sourceKind: 'gguf' } },
    tensors: { weight: { dtype: 'Q8_0', shape: [32, 32] } } };
  const selected = structuredClone(config);
  selected.inference.kernelPath = { id: 'explicit-f32', kvDtype: 'f32' };
  selected.inference.session.kvcache = { kvDtype: 'f16' };
  expect(() => requirePeerRepresentation(manifest, selected)).toThrow('native KV dtype must match');
  selected.inference.session.kvcache.kvDtype = 'f32';
  expect(requirePeerRepresentation(manifest, selected).cachePrecision).toMatchObject({
    native: 'f32', peer: 'f16', identical: false, exactTokenParityRequired: true });
  selected.inference.kernelPath.kvDtype = 'f16';
  selected.inference.session.kvcache.kvDtype = 'f16';
  expect(requirePeerRepresentation(manifest, selected).cachePrecision.identical).toBe(true);
});

it('rejects wrong worker pins and incomplete responses, then closes its actual worker', async () => {
  const source = "import {parentPort} from 'node:worker_threads';parentPort.on('message',({id})=>parentPort.postMessage({id,qs:new Uint8Array(1),scales:new Uint32Array(1)}));";
  const sha256 = createHash('sha256').update(source).digest('hex');
  expect(() => createQ5Converter({ source, sha256: '0'.repeat(64) })).toThrow('bytes differ');
  const converter = createQ5Converter({ source, sha256, maxInputBytes: 1024, maxOutputBytes: 2048 });
  try { await expect(converter.convert(new ArrayBuffer(22), [1, 32])).rejects.toThrow('incomplete'); }
  finally { await converter.close(); }
  await expect(converter.convert(new ArrayBuffer(22), [1, 32])).rejects.toThrow('closed');
});

it('terminates a pending CPU converter on cancellation before publishing output', async () => {
  const source = "import {parentPort} from 'node:worker_threads';parentPort.on('message',()=>{});";
  const control = new AbortController(), converter = createQ5Converter({ source, sha256: createHash('sha256').update(source).digest('hex'),
    signal: control.signal, maxInputBytes: 1024, maxOutputBytes: 2048 });
  const pending = expect(converter.convert(new ArrayBuffer(22), [1, 32])).rejects.toThrow('cancel converter');
  control.abort(new Error('cancel converter'));
  await pending; await converter.close();
});
