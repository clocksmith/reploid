/**
 * The model's non-weight files a stage process opens: every file the catalog lists for the model under a role other
 * than weights (for the Stage 1 model: the manifest, the tokenizer and the piece index). Taken from those roles, never
 * from a fixed list. They hold no tensor weights, so no weight inventory, loaded-range or requester rule counts them.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveServedFile } from '../../server/browser-roots.js';

export const WEIGHT_ROLES = Object.freeze(['model-weights']);
const SERVED_PIECE_INDEX = '/config/model-pieces/';
const refuse = message => Object.assign(Error(`stage-metadata-refused: ${message}`), { code: 'stage-metadata-refused' });

/** `{ role, path, sizeBytes, digest, url }` for each non-weight file of `model`, in catalog order. */
export function metadataFiles(model) {
  const rows = (model?.source?.files ?? []).filter(file => !WEIGHT_ROLES.includes(file.role)).map(file => {
    if (typeof file.path !== 'string' || path.basename(file.path) !== file.path) throw refuse('a metadata file is not a plain file name');
    if ((file.hashAlgorithm ?? 'sha256') !== 'sha256' || !/^[a-f0-9]{64}$/.test(file.hash ?? '')) throw refuse(`${file.path} has no pinned sha256`);
    return { role: file.role, path: file.path, sizeBytes: file.sizeBytes ?? null, digest: 'sha256:' + file.hash, url: file.url ?? null };
  });
  if (!rows.some(row => row.role === 'model-manifest')) throw refuse('the catalog names no model manifest');
  if (new Set(rows.map(row => row.path)).size !== rows.length) throw refuse('two metadata files share a name');
  return rows;
}

/** The piece index's bytes, from the served copy when the catalog serves it, else from `modelDirectory`; checked against its pin. */
export async function readPieceIndexBytes({ model, modelDirectory }) {
  const descriptor = metadataFiles(model).find(row => row.role === 'model-piece-index');
  if (!descriptor) throw refuse('the catalog names no piece index');
  const bytes = new Uint8Array(await fs.readFile(descriptor.url?.startsWith(SERVED_PIECE_INDEX) ? resolveServedFile(descriptor.url)
    : path.join(await fs.realpath(modelDirectory), descriptor.path)));
  if ('sha256:' + createHash('sha256').update(bytes).digest('hex') !== descriptor.digest) throw Error('The stage piece index differs from the catalog');
  return { bytes, digest: descriptor.digest };
}

/** Every piece the index lists for a metadata file, as the stage loader is asked for them: `{ path, offset, size, identity, role }`. */
export function metadataPieces(model, indexBytes) {
  const roles = new Map(metadataFiles(model).map(row => [row.path, row.role]));
  const index = JSON.parse(new TextDecoder().decode(indexBytes));
  return (index.files ?? []).filter(file => roles.has(file.path)).flatMap(file => file.pieces.map(piece =>
    ({ path: file.path, offset: piece.offset, size: piece.size, identity: piece.identity, role: roles.get(file.path) })));
}
