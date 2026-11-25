// @vitest-environment node
// The window-free compare check (`--prepare-stage-directories check`) against real directories on this machine. Each
// host's control requests run the real host agent in process: the weight searches, fingerprints and baselines are the
// harness code; only the byte reader is wrapped to count what it hashes and the build-record check is scripted.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { runHostAgent } from '../../scripts/stage1/host-agent.js';
import { measureHeldRanges, summarizeRanges } from '../../scripts/stage1/inventory.js';
import { createPhysicalStage1Adapter, WEIGHT_SCAN_RELEASE } from '../../scripts/stage1/physical-adapter.js';

const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const RELEASE = { sha: 'e'.repeat(40), harnessDigest: 'sha256:' + 'd'.repeat(64) };
let root;
beforeEach(async () => { root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'stage1-check-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

/** Two stages over two real shard files; each host's stage directory holds its own shard, its full copy both. */
async function setUp() {
  const pieces = [1, 2, 3, 4].map(value => Buffer.alloc(32, value));
  const range = (file, offset, bytes) => ({ path: file, offset, size: bytes.length, identity: sha(bytes) });
  const stageRanges = [[range('s0.bin', 0, pieces[0]), range('s0.bin', 32, pieces[1])], [range('s1.bin', 0, pieces[2]), range('s1.bin', 32, pieces[3])]];
  const files = { 's0.bin': Buffer.concat(pieces.slice(0, 2)), 's1.bin': Buffer.concat(pieces.slice(2)) };
  const write = async (directory, names) => {
    await fs.mkdir(directory, { recursive: true });
    for (const name of names) await fs.writeFile(path.join(directory, name), files[name]);
  };
  const host = async (label, index) => {
    const home = path.join(root, label);
    await write(path.join(home, 'models', 'stage'), [`s${index}.bin`]);
    await write(path.join(home, 'models', 'full'), ['s0.bin', 's1.bin']);
    await fs.mkdir(path.join(home, 'cache'), { recursive: true });
    return { label, ssh: label, node: '/bin/node', releaseRoot: home, stateDirectory: path.join(home, 'state'), stageDirectory: path.join(home, 'models', 'stage'),
      fullCopyDirectory: path.join(home, 'models', 'full'), weightRoots: { model: [path.join(home, 'models')], cache: [path.join(home, 'cache')], temporary: [] } };
  };
  const requester = path.join(root, 'requester');
  await fs.mkdir(path.join(requester, 'empty'), { recursive: true });
  const config = { limits: { phaseMs: 20000, abortGraceMs: 200, hardStopMs: 1500, stopMarginMs: 2000, serviceRestoreMs: 300 },
    credit: { weights: [1, 1] },
    requester: { ssh: 'requester', node: '/bin/node', releaseRoot: requester, modelDirectory: path.join(requester, 'empty'), stateDirectory: path.join(requester, 'state'),
      weightRoots: { model: [path.join(requester, 'models')], cache: [], temporary: [] } },
    hosts: [await host('host-a', 0), await host('host-b', 1)] };
  const hashed = [], controls = [];
  const transport = {
    async run(target, argv, { input }) {
      controls.push({ machine: target.label, op: JSON.parse(input).op });
      const output = new PassThrough();
      let stdout = '';
      output.on('data', chunk => { stdout += chunk; });
      await runHostAgent({ mode: argv.at(-1), input: Readable.from([Buffer.from(input)]), output, ports: {
        measure: args => { hashed.push({ machine: target.label, directory: args.directory }); return measureHeldRanges(args); },
        stageDirectory: async body => ({ verified: 'record', stageIndex: body.stageIndex, ...summarizeRanges(body.stageRanges) }),
        releaseSha: async () => RELEASE.sha, harnessDigest: async () => RELEASE.harnessDigest } });
      return { code: 0, stdout };
    },
    open() { throw Error('The check opens no session'); }
  };
  const expectations = { stages: stageRanges.map(ranges => summarizeRanges(ranges)) };
  const adapter = createPhysicalStage1Adapter({ config, directory: null, transport, expectations, stageRanges, model: {}, fixture: {}, fixtureBytes: Buffer.from('{}') });
  return { config, adapter, hashed, controls, files };
}

describe('the window-free compare check', () => {
  it('compares an unchanged tree without hashing any weight bytes or writing a baseline', async () => {
    const { config, adapter, hashed, controls } = await setUp();
    const recorded = await adapter.recordWeightBaselines({});
    expect(Object.values(recorded).every(row => row.ok)).toBe(true);
    const baselineFile = path.join(config.hosts[1].stateDirectory, 'weight-baseline-host-weight-directories.json');
    const before = await fs.stat(baselineFile, { bigint: true });
    hashed.length = 0; controls.length = 0;
    const machines = await adapter.checkWeightBaselines({ release: RELEASE, notBefore: '2000-01-01T00:00:00Z' });
    expect(hashed).toEqual([]);
    expect((await fs.stat(baselineFile, { bigint: true })).mtimeNs).toBe(before.mtimeNs);
    for (const label of ['host-a', 'host-b']) {
      expect(machines[label]).toMatchObject({ ok: true, problems: [], directoriesCompared: 2, rehashedDirectories: 0, rehashed: [], matchedBaseline: true,
        release: RELEASE, stageDirectoryRecord: { ok: true, verified: 'record' } });
      expect(machines[label].scans['stage-directory']).toMatchObject({ ok: true, rangeCount: 2, evidence: 'unchanged-since-hash', unchangedDirectories: 1,
        hashedDirectories: 0, goneDirectories: 0 });
      expect(Date.parse(machines[label].scans['stage-directory'].endedAt)).toBeGreaterThanOrEqual(Date.parse(machines[label].scans['stage-directory'].startedAt));
      expect(typeof machines[label].scanMs).toBe('number');
    }
    expect(machines.requester).toMatchObject({ ok: true, directoriesCompared: 0, matchedBaseline: true, scans: { 'requester-weight-directories': { heldRanges: 0 } } });
    expect(new Set(controls.map(row => row.op))).toEqual(new Set(['release', 'stage-directory', 'scan-weights', 'directory-bytes']));
  });

  it('re-hashes a directory whose file changed and reports which one and why', async () => {
    const { config, adapter, hashed, files } = await setUp();
    await adapter.recordWeightBaselines({});
    const shard = path.join(config.hosts[1].stageDirectory, 's1.bin');
    await fs.writeFile(shard, files['s1.bin']);
    hashed.length = 0;
    const machines = await adapter.checkWeightBaselines({ release: RELEASE, notBefore: '2000-01-01T00:00:00Z' });
    // Both of host-b's searches cover its stage directory; nothing else anywhere is read.
    expect(hashed).toEqual([{ machine: 'host-b', directory: config.hosts[1].stageDirectory }, { machine: 'host-b', directory: config.hosts[1].stageDirectory }]);
    expect(machines['host-a']).toMatchObject({ ok: true, rehashedDirectories: 0 });
    expect(machines['host-b']).toMatchObject({ ok: false, matchedBaseline: false, rehashedDirectories: 2,
      rehashed: [{ scope: 'stage-directory', root: 0, path: '.', reason: 'changed' }, { scope: 'host-weight-directories', root: 0, path: '.', reason: 'changed' }] });
    expect(machines['host-b'].problems).toContain('baseline-differs: 1 directories re-hashed, 0 gone');
    // The bytes are the same, so the stage still holds exactly its ranges.
    expect(machines['host-b'].scans['stage-directory']).toMatchObject({ ok: true, rangeCount: 2, evidence: 'hashed-now' });
  });

  it('fails a machine whose baseline is missing, without hashing, and one recorded before the scan release', async () => {
    const { config, adapter, hashed } = await setUp();
    await adapter.recordWeightBaselines({});
    await fs.rm(path.join(config.hosts[0].stateDirectory, 'weight-baseline-stage-directory.json'));
    hashed.length = 0;
    const machines = await adapter.checkWeightBaselines({ release: RELEASE, notBefore: '2000-01-01T00:00:00Z' });
    expect(hashed).toEqual([]);
    expect(machines['host-a']).toMatchObject({ ok: false, matchedBaseline: false, scans: { 'stage-directory': { ok: false, code: 'weight-baseline-missing' } } });
    expect(machines['host-a'].problems).toContain('stage-directory: weight-baseline-missing');
    expect(machines['host-b'].ok).toBe(true);
    // The real release floor: these baselines were recorded now, after it; a floor in the future makes them stale.
    expect(Date.parse(WEIGHT_SCAN_RELEASE.committedAt)).toBeLessThan(Date.now());
    const stale = await adapter.checkWeightBaselines({ release: RELEASE, notBefore: new Date(Date.now() + 3600000).toISOString() });
    expect(stale['host-b'].ok).toBe(false);
    expect(stale['host-b'].problems.some(problem => problem.startsWith('baseline-older-than-release'))).toBe(true);
  });

  it('fails a machine running other harness code or another release', async () => {
    const { adapter } = await setUp();
    await adapter.recordWeightBaselines({});
    const machines = await adapter.checkWeightBaselines({ release: { sha: 'f'.repeat(40), harnessDigest: 'sha256:' + '0'.repeat(64) }, notBefore: '2000-01-01T00:00:00Z' });
    for (const row of Object.values(machines)) expect(row.problems).toEqual(expect.arrayContaining(['harness-digest-differs', `release-sha-differs: ${RELEASE.sha}`]));
  });
});
