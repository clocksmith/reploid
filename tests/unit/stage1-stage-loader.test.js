// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStageLoader } from '../../scripts/stage1/stage-loader.js';
import { summarizeRanges } from '../../scripts/stage1/inventory.js';

const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
let root, stage, assigned, other;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'stage1-loader-'));
  stage = path.join(root, 'stage');
  await fs.mkdir(stage);
  const pieces = [Buffer.alloc(16, 1), Buffer.alloc(16, 2), Buffer.alloc(16, 3)];
  await fs.writeFile(path.join(stage, 's0.bin'), Buffer.concat(pieces.slice(0, 2)));
  await fs.writeFile(path.join(root, 's1.bin'), pieces[2]);
  assigned = [{ path: 's0.bin', offset: 0, size: 16, identity: sha(pieces[0]) }, { path: 's0.bin', offset: 16, size: 16, identity: sha(pieces[1]) }];
  other = { path: 's1.bin', offset: 0, size: 16, identity: sha(pieces[2]) };
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('the stage loader', () => {
  it('serves its assigned ranges from the stage directory and records exactly what it served', async () => {
    const loader = createStageLoader({ directory: stage, assignedRanges: assigned });
    expect(Buffer.from(await loader.read(assigned[1]))).toEqual(Buffer.alloc(16, 2));
    expect(loader.accounting()).toEqual({ source: 'stage-loader', ...summarizeRanges([assigned[1]]), outsideStageRanges: 0, outsideStageBytes: 0,
      metadata: { roles: [], pieceCount: 0, bytes: 0 } });
    await loader.read(assigned[0]);
    await loader.read(assigned[0]);
    expect(loader.accounting()).toMatchObject({ ...summarizeRanges(assigned), outsideStageRanges: 0 });
  });

  it('refuses and records a range outside its stage, a changed size and a path that leaves the directory', async () => {
    const loader = createStageLoader({ directory: stage, assignedRanges: assigned });
    await expect(loader.read(other)).rejects.toMatchObject({ code: 'stage-loader-refused' });
    await expect(loader.read({ ...assigned[0], size: 32 })).rejects.toMatchObject({ code: 'stage-loader-refused' });
    await expect(loader.read({ ...assigned[0], path: '../s1.bin' })).rejects.toMatchObject({ code: 'stage-loader-refused' });
    expect(loader.accounting()).toMatchObject({ rangeCount: 0, outsideStageRanges: 3, outsideStageBytes: 64 });
  });

  it('refuses an assigned name that is a link out of the stage directory', async () => {
    await fs.rm(path.join(stage, 's0.bin'));
    await fs.symlink(path.join(root, 's1.bin'), path.join(stage, 's0.bin'));
    const loader = createStageLoader({ directory: stage, assignedRanges: assigned });
    await expect(loader.read(assigned[0])).rejects.toMatchObject({ code: 'stage-loader-refused' });
    expect(loader.accounting().rangeCount).toBe(0);
  });

  it('serves the tokenizer as metadata, apart from and never counted as weight ranges', async () => {
    const tokenizer = Buffer.from('{"model":{"vocab":{"a":0}}}');
    await fs.writeFile(path.join(stage, 'tokenizer.json'), tokenizer);
    const metadataPieces = [{ path: 'tokenizer.json', offset: 0, size: 10, identity: sha(tokenizer.subarray(0, 10)), role: 'tokenizer' },
      { path: 'tokenizer.json', offset: 10, size: tokenizer.length - 10, identity: sha(tokenizer.subarray(10)), role: 'tokenizer' }];
    const loader = createStageLoader({ directory: stage, assignedRanges: assigned, metadataPieces });
    const read = Buffer.concat([await loader.read(metadataPieces[0]), await loader.read(metadataPieces[1])]);
    expect(read).toEqual(tokenizer);
    for (const range of assigned) await loader.read(range);
    expect(loader.accounting()).toEqual({ source: 'stage-loader', ...summarizeRanges(assigned), outsideStageRanges: 0, outsideStageBytes: 0,
      metadata: { roles: ['tokenizer'], pieceCount: 2, bytes: tokenizer.length } });
    await expect(loader.read({ ...metadataPieces[0], size: 11 })).rejects.toMatchObject({ code: 'stage-loader-refused' });
    expect(() => createStageLoader({ directory: stage, assignedRanges: assigned, metadataPieces: [{ ...assigned[0], role: 'tokenizer' }] })).toThrow('non-weight');
  });

  it('needs an absolute directory and an allowlist', () => {
    expect(() => createStageLoader({ directory: 'stage', assignedRanges: assigned })).toThrow('absolute');
    expect(() => createStageLoader({ directory: stage, assignedRanges: [] })).toThrow('assigned ranges');
  });
});
