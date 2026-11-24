#!/usr/bin/env node
/**
 * Builds or verifies one Stage 1 stage directory: the directory a stage process opens, holding exactly its assigned
 * piece ranges and nothing of the other stage. The full copy it reads from stays where it is and is never written.
 *
 * Layout, as the stage loader (stage-loader.js) and the stage participant's piece source read it: `manifest.json` is
 * the model manifest byte for byte; each shard keeps its file name, and each assigned range sits at its original
 * offset in it. Bytes outside the assigned ranges are never written, so a shard that also holds the other stage's
 * ranges becomes a sparse file whose other-stage bytes read as zeros. `stage-directory.json`, written last, records
 * the stage, its range count, byte total and ranges digest; a directory without it is an unfinished build.
 *
 *   node scripts/stage1/build-stage-directory.js --stage 0|1 --source FULL_COPY --target STAGE_DIRECTORY
 *   node scripts/stage1/build-stage-directory.js --stage 0|1 --target STAGE_DIRECTORY --verify [--hash]
 *
 * Reads every assigned byte of the full copy; run it outside any timed GPU window.
 */
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import { measureHeldRanges, rangesDigest, summarizeRanges } from './inventory.js';
import { assertCompleteCopy } from './host-control.js';
import { readPieceInventory, STAGE1_MODEL_ID, STAGE1_PINS } from './expectations.js';

export const STAGE_DIRECTORY_SCHEMA = 'reploid.stage1-stage-directory/v1';
export const STAGE_DIRECTORY_MANIFEST = 'stage-directory.json';
const MODEL_MANIFEST = 'manifest.json';

const coded = (code, message) => Object.assign(Error(`${code}: ${message}`), { code });
const sha256 = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);

/** Groups ranges by shard file in offset order, refusing a non-plain name, a negative or overlapping range. */
function rangesByFile(ranges) {
  const files = new Map();
  for (const range of ranges) {
    if (typeof range?.path !== 'string' || path.basename(range.path) !== range.path || range.path === STAGE_DIRECTORY_MANIFEST || range.path === MODEL_MANIFEST) {
      throw coded('stage-directory-refused', 'a range names something other than a plain shard file');
    }
    if (!Number.isSafeInteger(range.offset) || range.offset < 0 || !Number.isSafeInteger(range.size) || range.size <= 0
      || typeof range.identity !== 'string' || !range.identity.startsWith('sha256:')) throw coded('stage-directory-refused', 'a range is malformed');
    if (!files.has(range.path)) files.set(range.path, []);
    files.get(range.path).push(range);
  }
  for (const rows of files.values()) {
    rows.sort((a, b) => a.offset - b.offset);
    rows.forEach((row, index) => { if (index && rows[index - 1].offset + rows[index - 1].size > row.offset) throw coded('stage-directory-refused', 'two ranges overlap'); });
  }
  return files;
}

/** The ranges must be exactly the pinned stage: count, bytes and, when pinned, the digest. */
function assertPinned(stageRanges, pin) {
  const summary = summarizeRanges(stageRanges);
  if (summary.rangeCount !== pin.rangeCount || summary.bytes !== pin.bytes || (pin.rangesDigest && summary.rangesDigest !== pin.rangesDigest)) {
    throw coded('stage-directory-pin-mismatch', `the ranges are ${summary.rangeCount}/${summary.bytes}/${summary.rangesDigest}, not the pinned stage`);
  }
  return summary;
}

async function readExactly(handle, size, position) {
  const bytes = Buffer.allocUnsafe(size);
  let received = 0;
  while (received < size) {
    const { bytesRead } = await handle.read(bytes, received, size - received, position + received);
    if (bytesRead === 0) return null;
    received += bytesRead;
  }
  return bytes;
}

async function writeExactly(handle, bytes, position) {
  let written = 0;
  while (written < bytes.length) written += (await handle.write(bytes, written, bytes.length - written, position + written)).bytesWritten;
}

/** Ranges of the other stage that lie inside the extent of a file this directory holds: zeros there must not hash to them. */
const otherInExtent = (files, otherRanges) => otherRanges.filter(range => {
  const rows = files.get(range.path);
  return rows && range.offset + range.size <= rows.at(-1).offset + rows.at(-1).size;
});

/**
 * Writes `target` from the verified full copy at `source`. `pin` is `{ rangeCount, bytes, rangesDigest? }`;
 * `otherRanges` are the rest of the model's ranges, used only to prove none of them is readable from the result.
 * Refuses an existing target, and removes what it created if it fails part way.
 */
export async function buildStageDirectory({ source, target, stageIndex, stageRanges, otherRanges = [], pin, model, inventorySha256, signal }) {
  if (typeof target !== 'string' || !path.isAbsolute(target) || path.resolve(target) !== target) throw coded('stage-directory-refused', 'the target is not an exact absolute path');
  if (typeof source !== 'string' || !path.isAbsolute(source)) throw coded('stage-directory-refused', 'the source is not an absolute path');
  if (!Number.isSafeInteger(stageIndex) || stageIndex < 0) throw coded('stage-directory-refused', 'no stage index');
  const summary = assertPinned(stageRanges, pin), files = rangesByFile(stageRanges);
  const realSource = await fs.realpath(source);
  await assertCompleteCopy({ directory: realSource, expectedIdentity: model.identity });
  const manifestBytes = await fs.readFile(path.join(realSource, MODEL_MANIFEST));
  const shardSizes = new Map(JSON.parse(manifestBytes).shards.map(shard => [shard.filename, shard.size]));
  for (const [name, rows] of files) {
    const end = rows.at(-1).offset + rows.at(-1).size;
    if (!shardSizes.has(name) || end > shardSizes.get(name)) throw coded('stage-directory-refused', `${name} is not a shard of this model or a range runs past its end`);
  }
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const realParent = await fs.realpath(path.dirname(target)), realTarget = path.join(realParent, path.basename(target));
  if (inside(realTarget, realSource) || inside(realSource, realTarget)) throw coded('stage-directory-refused', 'the target and the full copy overlap');
  const free = await fs.statfs(realParent).then(stat => stat.bavail * stat.bsize, () => null);
  if (free !== null && free < summary.bytes + manifestBytes.length) throw coded('stage-directory-no-space', `${summary.bytes} bytes are needed, ${free} are free`);
  try { await fs.mkdir(realTarget, { mode: 0o700 }); }
  catch (error) { if (error.code === 'EEXIST') throw coded('stage-directory-exists', 'the stage directory already exists; it is never overwritten'); throw error; }
  try {
    await fs.writeFile(path.join(realTarget, MODEL_MANIFEST), manifestBytes, { flag: 'wx', mode: 0o600 });
    const written = [];
    for (const [name, rows] of files) {
      signal?.throwIfAborted();
      const input = await fs.open(path.join(realSource, name), 'r');
      const output = await fs.open(path.join(realTarget, name), 'wx+', 0o600);
      try {
        for (const range of rows) {
          signal?.throwIfAborted();
          const bytes = await readExactly(input, range.size, range.offset);
          if (!bytes || sha256(bytes) !== range.identity) throw coded('stage-directory-digest-mismatch', `the full copy's ${name} at ${range.offset} does not match its pinned digest`);
          await writeExactly(output, bytes, range.offset);
        }
        await output.datasync();
        // Read back what was written: every range in the stage directory must hash to its pinned digest.
        for (const range of rows) {
          signal?.throwIfAborted();
          const bytes = await readExactly(output, range.size, range.offset);
          if (!bytes || sha256(bytes) !== range.identity) throw coded('stage-directory-digest-mismatch', `the written ${name} at ${range.offset} does not match its pinned digest`);
        }
      } finally { await Promise.all([input.close(), output.close()]); }
      written.push({ path: name, rangeCount: rows.length, bytes: rows.reduce((sum, row) => sum + row.size, 0) });
    }
    const leaked = await measureHeldRanges({ directory: realTarget, ranges: otherInExtent(files, otherRanges), signal });
    if (leaked.length) throw coded('stage-directory-holds-other-stage', `${leaked.length} other-stage ranges read back from the stage directory`);
    const record = { schema: STAGE_DIRECTORY_SCHEMA, modelId: model.id, modelIdentity: model.identity, inventorySha256, stageIndex, ...summary, files: written };
    await fs.writeFile(path.join(realTarget, STAGE_DIRECTORY_MANIFEST), JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { built: true, verified: 'hashed', ...record };
  } catch (error) {
    await fs.rm(realTarget, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Checks an existing stage directory against the pin without rebuilding it: its record names this model, inventory
 * and stage with the pinned count, bytes and digest; its model manifest is the catalog's; every shard is present and
 * long enough. `hash` also re-reads every assigned range and checks no other-stage range is readable.
 */
export async function verifyStageDirectory({ directory, stageIndex, stageRanges, otherRanges = [], pin, model, inventorySha256, hash = false, signal }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw coded('stage-directory-refused', 'the stage directory is not an absolute path');
  const summary = assertPinned(stageRanges, pin), files = rangesByFile(stageRanges);
  let record;
  try { record = JSON.parse(await fs.readFile(path.join(directory, STAGE_DIRECTORY_MANIFEST), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw coded('stage-directory-unbuilt', 'the stage directory has no finished build record');
    throw coded('stage-directory-invalid', 'the build record is unreadable');
  }
  const mismatch = field => { throw coded('stage-directory-mismatch', `the build record's ${field} differs from the pin`); };
  if (record?.schema !== STAGE_DIRECTORY_SCHEMA) mismatch('schema');
  if (record.modelId !== model.id || record.modelIdentity !== model.identity) mismatch('model');
  if (record.inventorySha256 !== inventorySha256) mismatch('inventory');
  if (record.stageIndex !== stageIndex) mismatch('stage');
  for (const key of ['rangeCount', 'bytes', 'rangesDigest']) if (record[key] !== summary[key]) mismatch(key);
  const manifestBytes = await fs.readFile(path.join(directory, MODEL_MANIFEST)).catch(() => null);
  if (!manifestBytes || sha256(manifestBytes) !== model.identity) mismatch('model manifest');
  for (const [name, rows] of files) {
    const stat = await fs.lstat(path.join(directory, name)).catch(() => null);
    if (!stat?.isFile() || stat.size < rows.at(-1).offset + rows.at(-1).size) throw coded('stage-directory-incomplete', `${name} is missing or short`);
  }
  if (hash) {
    const held = await measureHeldRanges({ directory, ranges: stageRanges, signal });
    if (held.length !== stageRanges.length) throw coded('stage-directory-digest-mismatch', `${stageRanges.length - held.length} assigned ranges do not match their pinned digests`);
    const leaked = await measureHeldRanges({ directory, ranges: otherInExtent(files, otherRanges), signal });
    if (leaked.length) throw coded('stage-directory-holds-other-stage', `${leaked.length} other-stage ranges read back from the stage directory`);
  }
  return { verified: hash ? 'hashed' : 'record', stageIndex, ...summary };
}

/** Stage 1's own pin: the pinned inventory's ranges for `stageIndex`, checked against its pinned count and bytes. */
export async function loadPinnedStage(stageIndex, { readInventory = readPieceInventory } = {}) {
  const pinned = STAGE1_PINS.stages[stageIndex];
  if (!pinned) throw coded('stage-directory-refused', 'no such stage');
  const { sha256: inventorySha256, inventory } = await readInventory();
  if (inventorySha256 !== STAGE1_PINS.inventorySha256) throw coded('stage-directory-pin-mismatch', 'the piece inventory differs from its pin');
  const stageRanges = inventory.stages[stageIndex].ranges;
  const otherRanges = inventory.stages.filter((_, index) => index !== stageIndex).flatMap(stage => stage.ranges);
  return { stageIndex, stageRanges, otherRanges, pin: { ...pinned, rangesDigest: rangesDigest(stageRanges) }, inventorySha256,
    model: catalog.find(row => row.id === STAGE1_MODEL_ID) };
}

/**
 * The host-agent operation. The operator sends the ranges it derived from the pinned inventory; the host checks them
 * against its own Stage 1 pins (count and bytes) and the operator's digest before reading or writing anything.
 */
export async function stageDirectoryOperation({ action, source = null, directory, stageIndex, stageRanges, otherRanges = [], rangesDigest: digest,
  inventorySha256, hash = false }, { signal } = {}) {
  const pinned = STAGE1_PINS.stages[stageIndex];
  if (!pinned) throw coded('stage-directory-refused', 'no such stage');
  if (inventorySha256 !== STAGE1_PINS.inventorySha256) throw coded('stage-directory-pin-mismatch', 'the operator\'s inventory differs from the host\'s pin');
  const common = { stageIndex, stageRanges, otherRanges, pin: { ...pinned, rangesDigest: digest }, inventorySha256,
    model: catalog.find(row => row.id === STAGE1_MODEL_ID), signal };
  let result;
  if (action === 'build') result = await buildStageDirectory({ ...common, source, target: directory });
  else if (action === 'verify') result = await verifyStageDirectory({ ...common, directory, hash });
  else throw coded('stage-directory-refused', 'unknown action');
  // Counts and digests only: no host path goes back.
  const { files: _files, ...counts } = result;
  return counts;
}

async function main() {
  const { values } = parseArgs({ options: { stage: { type: 'string' }, source: { type: 'string' }, target: { type: 'string' },
    verify: { type: 'boolean' }, hash: { type: 'boolean' } } });
  const stageIndex = Number(values.stage);
  if (!['0', '1'].includes(values.stage) || !values.target || !path.isAbsolute(values.target) || (values.verify ? values.source : !values.source || !path.isAbsolute(values.source))
    || (values.hash && !values.verify)) {
    throw Error('Usage: build-stage-directory.js --stage 0|1 --source ABSOLUTE_FULL_COPY --target ABSOLUTE_STAGE_DIRECTORY\n'
      + '       build-stage-directory.js --stage 0|1 --target ABSOLUTE_STAGE_DIRECTORY --verify [--hash]');
  }
  const stop = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => stop.abort(Error(`Received ${name}`)));
  const pinned = await loadPinnedStage(stageIndex);
  const result = values.verify
    ? await verifyStageDirectory({ ...pinned, directory: path.resolve(values.target), hash: values.hash === true, signal: stop.signal })
    : await buildStageDirectory({ ...pinned, source: values.source, target: path.resolve(values.target), signal: stop.signal });
  const { files: _files, ...counts } = result;
  process.stdout.write(JSON.stringify(counts, null, 2) + '\n');
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) {
  try { await main(); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
