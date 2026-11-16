// Offline diagnostic composition only; the caller owns numerical/GPU execution.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { openNativeModelSource } from '../../server/native-model-source.js';
import { resolveServedFile } from '../../server/browser-roots.js';

/** Metadata-only readiness. This never imports a model runtime or reads weights. */
export async function inspectDiagnosticModel(config) {
  const manifestBytes = await fs.readFile(config.manifestPath);
  const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
  assert.equal(manifestSha256, config.manifestSha256, 'Diagnostic manifest identity mismatch');
  const descriptor = config.pieceIndex;
  assert(descriptor?.role === 'model-piece-index' && descriptor.hashAlgorithm === 'sha256'
    && /^[a-f0-9]{64}$/u.test(descriptor.hash), 'Diagnostic requires pinned pieceIndex');
  const root = await fs.realpath(path.dirname(config.manifestPath));
  assert(descriptor.url?.startsWith('/config/model-pieces/') || typeof descriptor.path === 'string'
    && /^[a-zA-Z0-9_.-]+$/u.test(descriptor.path) && !['.', '..'].includes(descriptor.path), 'Invalid diagnostic index path');
  const indexPath = descriptor.url?.startsWith('/config/model-pieces/')
    ? resolveServedFile(descriptor.url) : path.join(root, descriptor.path);
  const indexBytes = await fs.readFile(indexPath);
  assert.equal(createHash('sha256').update(indexBytes).digest('hex'), descriptor.hash, 'Diagnostic piece index identity mismatch');
  const index = JSON.parse(indexBytes);
  assert(index.schema === 'doppler.verified-pieces/v1' && Array.isArray(index.files)
    && index.manifestIdentity === 'sha256:' + manifestSha256, 'Diagnostic index manifest binding mismatch');
  const files = await Promise.all(index.files.map(async file => {
    assert(typeof file.path === 'string' && /^[a-zA-Z0-9_.-]+$/u.test(file.path) && !['.', '..'].includes(file.path), 'Invalid diagnostic source filename');
    try {
      const filename = await fs.realpath(path.join(root, file.path)), stat = await fs.stat(filename);
      const available = path.dirname(filename) === root && stat.isFile() && stat.size === file.size;
      return { path: file.path, expectedBytes: file.size, available, reason: available ? null : 'not an in-root regular file of the declared size' };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { path: file.path, expectedBytes: file.size, available: false, reason: 'missing' };
    }
  }));
  return { scope: 'Metadata binding and whole-source file availability only; weight contents and model execution remain unverified',
    modelId: JSON.parse(manifestBytes).modelId, manifestIdentity: 'sha256:' + manifestSha256,
    indexIdentity: 'sha256:' + descriptor.hash, readyForWholeModel: files.every(file => file.available), files,
    weightContentsVerified: false, gpuOpened: false };
}

/** Use the pinned native source for compatibility whole-model loading. No URL
 * fallback or second manifest fetch can replace these authenticated bytes. */
export async function openDiagnosticWholeModel({ config, manifestBytes, model, runtime, load, signal, onSource }) {
  assert(config.pieceIndex, 'Whole diagnostic authenticated source requires a pinned pieceIndex');
  assert(manifestBytes instanceof Uint8Array, 'Whole diagnostic requires the captured manifest bytes');
  const manifestText = new TextDecoder().decode(manifestBytes);
  const digest = createHash('sha256').update(manifestBytes).digest('hex');
  assert.equal(digest, config.manifestSha256, 'Whole diagnostic manifest bytes changed');
  assert.equal(JSON.parse(manifestText).modelId, model.id, 'Whole diagnostic model id mismatch');
  const source = await openNativeModelSource({
    model: { ...model, source: { files: [config.pieceIndex] } },
    modelDirectory: path.dirname(config.manifestPath), runtime, gather: config.workerGather ?? null, signal,
  });
  try {
    // Retain failed sources too, so a later close can retry failed cleanup and
    // diagnostics cannot mistake their evidence for a subsequent successful owner.
    onSource(source);
    signal?.throwIfAborted();
    const loaded = await load({ manifest: source.manifest, manifestText, manifestHash: digest, storageContext: source.storage },
      { runtimeConfig: config.runtimeConfig, isolatedLoader: true, signal });
    return { model: loaded, source };
  } catch (error) {
    try { await source.storage.close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Whole diagnostic loading and source cleanup failed'); }
    throw error;
  }
}

/** Invoke only after all whole/resident owners have actually unloaded. */
export async function closeDiagnosticSources(sources) {
  const outcomes = await Promise.allSettled(sources.map(async source => source.storage.close()));
  const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : []);
  if (failures.length) throw new AggregateError(failures, 'Diagnostic source cleanup failed');
}
