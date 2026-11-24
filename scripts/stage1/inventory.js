/** Stage weight inventories: what a stage must hold, and what a host can show it holds. */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const rangeKey = range => `${range.path}\0${range.offset}\0${range.size}\0${range.identity}`;
const byPosition = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.offset - b.offset);

/** Independent of listing order: the same set of ranges always has the same digest. */
export function rangesDigest(ranges) {
  const rows = [...ranges].sort(byPosition).map(range => [range.path, range.offset, range.size, range.identity]);
  return 'sha256:' + sha256(JSON.stringify(rows));
}

export function summarizeRanges(ranges) {
  return { rangeCount: ranges.length, bytes: ranges.reduce((sum, range) => sum + range.size, 0), rangesDigest: rangesDigest(ranges) };
}

/**
 * What one host holds, compared to its stage. `source` says how the holding was established. `outsideStage*` can only
 * be nonzero when `held` came from a search of more than the stage's own ranges: `scannedRanges` records how many.
 */
export function observeInventory({ held, stageRanges, source, scope = null, scannedRanges = null }) {
  const assigned = new Set(stageRanges.map(rangeKey));
  const outside = held.filter(range => !assigned.has(rangeKey(range)));
  return { source, ...(scope ? { scope } : {}), ...(scannedRanges === null ? {} : { scannedRanges }), ...summarizeRanges(held),
    outsideStageRanges: outside.length, outsideStageBytes: outside.reduce((sum, range) => sum + range.size, 0) };
}

/**
 * Which of `ranges` this directory really holds: a range counts only when its bytes hash to its piece identity,
 * so a sparse, truncated or absent file holds nothing. Reads every candidate range; on a real host that is all
 * model bytes it has, so run it outside any timed GPU window.
 */
export async function measureHeldRanges({ directory, ranges, signal }) {
  const held = [], byFile = new Map();
  for (const range of ranges) {
    if (path.basename(range.path) !== range.path) throw Error('Piece index path must be a plain file name');
    if (!byFile.has(range.path)) byFile.set(range.path, []);
    byFile.get(range.path).push(range);
  }
  for (const [name, rows] of byFile) {
    let handle;
    try { handle = await fs.open(path.join(directory, name), 'r'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    try {
      for (const range of rows) {
        signal?.throwIfAborted();
        const bytes = Buffer.allocUnsafe(range.size);
        const { bytesRead } = await handle.read(bytes, 0, range.size, range.offset);
        if (bytesRead === range.size && 'sha256:' + sha256(bytes) === range.identity) held.push(range);
      }
    } finally { await handle.close(); }
  }
  return held;
}

/** Bytes and files under the directories a weightless requester may write to. Absent directories hold nothing. */
export async function measureDirectoryBytes(directories) {
  let weightBytes = 0, fileCount = 0;
  const visit = async directory => {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else { fileCount += 1; weightBytes += (await fs.lstat(file)).size; }
    }
  };
  for (const directory of directories) await visit(directory);
  return { weightBytes, fileCount };
}
