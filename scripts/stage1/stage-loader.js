/**
 * The only port through which a Stage 1 stage process reads weight pieces. It serves a piece only when the piece is one
 * of this stage's assigned ranges, or a piece of one of the model's non-weight files such as the tokenizer, and its
 * file sits directly in the stage directory; it records every piece it served and every one it refused. That record,
 * not a directory listing, is what the receipt reports as loaded, with non-weight pieces apart under `metadata`.
 *
 * On a real host Doppler decides which pieces to request (stage-participant.js hands this reader to its verified piece
 * storage). Under the fake runtime the fake requests its own assigned ranges, so there the record shows the plumbing only.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { summarizeRanges } from './inventory.js';

const key = (file, offset) => `${file}\0${offset}`;
const refuse = message => Object.assign(Error(`stage-loader-refused: ${message}`), { code: 'stage-loader-refused' });

/** Reads one byte range from a plain file name directly inside `directory`, refusing a link that leaves it. */
export async function readPieceBytes(directory, { path: file, offset, size }) {
  const root = await fs.realpath(directory), real = await fs.realpath(path.join(root, file));
  if (path.dirname(real) !== root) throw refuse('a piece file escapes the stage directory');
  const handle = await fs.open(real, 'r');
  try {
    const bytes = new Uint8Array(size);
    let received = 0;
    while (received < size) {
      const { bytesRead } = await handle.read(bytes, received, size - received, offset + received);
      if (bytesRead === 0) throw refuse('a piece read was truncated');
      received += bytesRead;
    }
    return bytes;
  } finally { await handle.close(); }
}

/**
 * `metadataPieces` are the pieces of the model's non-weight files (stage-metadata.js), such as the tokenizer, which every
 * stage opens. They are served from the same directory but recorded apart, under `metadata`: they are never weight
 * ranges, so they never count toward the loaded ranges a receipt judges.
 */
export function createStageLoader({ directory, assignedRanges, metadataPieces = [], readBytes = readPieceBytes }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw Error('An absolute stage directory is required');
  if (!Array.isArray(assignedRanges) || assignedRanges.length === 0) throw Error('The stage loader needs its assigned ranges');
  const allowed = new Map(assignedRanges.map(range => [key(range.path, range.offset), range]));
  const weightFiles = new Set(assignedRanges.map(range => range.path));
  if (metadataPieces.some(piece => weightFiles.has(piece.path) || typeof piece.role !== 'string')) throw Error('A metadata piece must be a non-weight file with its role');
  const metadata = new Map(metadataPieces.map(piece => [key(piece.path, piece.offset), piece]));
  const loaded = new Map(), refused = new Map(), metadataLoaded = new Map();
  return Object.freeze({
    /** The metadata pieces this loader serves, for a runtime that asks for them itself. */
    metadataPieces: Object.freeze(metadataPieces.map(piece => Object.freeze({ ...piece }))),
    async read(piece) {
      const plain = typeof piece?.path === 'string' && path.basename(piece.path) === piece.path;
      const range = plain ? allowed.get(key(piece.path, piece.offset)) : undefined;
      const file = plain && !range ? metadata.get(key(piece.path, piece.offset)) : undefined;
      const served = range ?? file;
      if (!served || served.size !== piece.size) {
        refused.set(key(piece?.path, piece?.offset), { path: String(piece?.path), offset: piece?.offset, size: piece?.size });
        throw refuse('the piece is not one of this stage\'s assigned ranges');
      }
      const bytes = await readBytes(directory, served);
      (range ? loaded : metadataLoaded).set(key(served.path, served.offset), served);
      return bytes;
    },
    /** Counts and digests only: the receipt never carries a host path. Metadata is reported apart from weight ranges. */
    accounting() {
      const outside = [...refused.values()], files = [...metadataLoaded.values()];
      return { source: 'stage-loader', ...summarizeRanges([...loaded.values()]),
        outsideStageRanges: outside.length, outsideStageBytes: outside.reduce((sum, row) => sum + (Number.isSafeInteger(row.size) ? row.size : 0), 0),
        metadata: { roles: [...new Set(files.map(row => row.role))].sort(), pieceCount: files.length, bytes: files.reduce((sum, row) => sum + row.size, 0) } };
    }
  });
}
