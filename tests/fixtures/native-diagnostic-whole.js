// Offline diagnostic composition only; the caller owns numerical/GPU execution.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { openDiagnosticModelSource, readDiagnosticMetadata, inspectDiagnosticSourceMap } from './native-diagnostic-source.js';

/** Metadata-only readiness. This never imports a model runtime or reads weights. */
export async function inspectDiagnosticModel(config) {
  const metadata = await readDiagnosticMetadata(config);
  const { root, index } = metadata;
  const files = config.sourceMap ? (await inspectDiagnosticSourceMap(config, metadata)).rows : await Promise.all(index.files.map(async file => {
    try {
      const filename = await fs.realpath(path.join(root, file.path)), stat = await fs.stat(filename);
      const available = path.dirname(filename) === root && stat.isFile() && stat.size === file.size;
      return { path: file.path, expectedBytes: file.size, available, reason: available ? null : 'not an in-root regular file of the declared size' };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return { path: file.path, expectedBytes: file.size, available: false, reason: 'missing' };
    }
  }));
  return { scope: 'Metadata binding and source-layout availability only; contents and model execution remain unverified',
    sourceLayout: config.sourceMap ? 'explicit-mapped-source' : 'canonical-in-root',
    modelId: metadata.manifest.modelId, manifestIdentity: 'sha256:' + config.manifestSha256,
    indexIdentity: 'sha256:' + config.pieceIndex.hash, readyForWholeModel: files.every(file => file.available), files,
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
  // The caller's signal bounds preparation. A successful model retains storage
  // until unload, so that deadline must not abort its later generation reads.
  const preparing = new AbortController();
  const cancelPreparation = () => preparing.abort(signal.reason);
  if (signal?.aborted) cancelPreparation();
  else signal?.addEventListener('abort', cancelPreparation, { once: true });
  let source;
  try {
    source = await openDiagnosticModelSource({ config, model, runtime, signal: preparing.signal, onSource });
    signal?.throwIfAborted();
    const loaded = await load({ manifest: source.manifest, manifestText, manifestHash: digest, storageContext: source.storage },
      { runtimeConfig: config.runtimeConfig, isolatedLoader: true, signal });
    return { model: loaded, source };
  } catch (error) {
    try { await source?.storage.close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Whole diagnostic loading and source cleanup failed'); }
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancelPreparation);
  }
}

/** Invoke only after all whole/resident owners have actually unloaded. */
export async function closeDiagnosticSources(sources) {
  const outcomes = await Promise.allSettled(sources.map(async source => source.storage.close()));
  const failures = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason] : []);
  if (failures.length) throw new AggregateError(failures, 'Diagnostic source cleanup failed');
}
