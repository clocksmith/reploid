/**
 * The only port through which a Stage 1 stage process reads weight pieces. It serves a piece only when the piece is one
 * of this stage's assigned ranges and its file sits directly in the stage directory, and it records every piece it
 * served and every one it refused. That record, not a directory listing, is what the receipt reports as loaded.
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

export function createStageLoader({ directory, assignedRanges, readBytes = readPieceBytes }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw Error('An absolute stage directory is required');
  if (!Array.isArray(assignedRanges) || assignedRanges.length === 0) throw Error('The stage loader needs its assigned ranges');
  const allowed = new Map(assignedRanges.map(range => [key(range.path, range.offset), range]));
  const loaded = new Map(), refused = new Map();
  return Object.freeze({
    async read(piece) {
      const range = allowed.get(key(piece?.path, piece?.offset));
      if (typeof piece?.path !== 'string' || path.basename(piece.path) !== piece.path || !range || range.size !== piece.size) {
        refused.set(key(piece?.path, piece?.offset), { path: String(piece?.path), offset: piece?.offset, size: piece?.size });
        throw refuse('the piece is not one of this stage\'s assigned ranges');
      }
      const bytes = await readBytes(directory, range);
      loaded.set(key(range.path, range.offset), range);
      return bytes;
    },
    /** Counts and digests only: the receipt never carries a host path. */
    accounting() {
      const outside = [...refused.values()];
      return { source: 'stage-loader', ...summarizeRanges([...loaded.values()]),
        outsideStageRanges: outside.length, outsideStageBytes: outside.reduce((sum, row) => sum + (Number.isSafeInteger(row.size) ? row.size : 0), 0) };
    }
  });
}
