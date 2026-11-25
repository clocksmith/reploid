// @vitest-environment node
// CPU tests for the matched single-requester-clock two-machine split comparison harness.
import { describe, expect, it } from 'vitest';
import { AssertionError } from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { summarizeSplitArm } from '../fixtures/peers/pooled/compare-split-single-clock.js';

const SOURCE = fileURLToPath(new URL('../fixtures/peers/pooled/compare-split-single-clock.js', import.meta.url));
const run = promisify(execFile);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const WORKER = `import readline from 'node:readline';
const kind = process.argv[2];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
for await (const line of readline.createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  const op = request.op;
  let value;
  if (op === 'open') {
    await sleep(kind === 'candidate' ? 20 : 60);
    value = { split: { ranges: [[0, 43], [43, 48]] } };
  } else if (op === 'request') {
    const delay = kind === 'candidate' ? (request.repeat === 0 ? 30 : 10) : (request.repeat === 0 ? 25 : 20);
    const started = performance.now();
    await sleep(delay);
    value = { text: 'exact-split-answer', requestWallMs: performance.now() - started };
  } else {
    value = { cleanup: 'settled' };
  }
  process.stdout.write('@q4-response ' + JSON.stringify({ id: request.id, requestOp: op, value }) + '\\n');
  if (op === 'close') break;
}
process.stdin.destroy();
`;

describe('compare-split-single-clock', () => {
  it('separates startup, post-open first request and repeats on one requester clock', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-split-'));
    const cacheDir = path.join('/tmp', `a1-split-test-cache-${sha256(root).slice(0, 12)}`);
    try {
      const workerFile = path.join(root, 'worker.mjs');
      fs.writeFileSync(workerFile, WORKER);
      fs.mkdirSync(cacheDir, { recursive: true });
      fs.writeFileSync(path.join(cacheDir, 'piece.bin'), 'stale');
      const freeze = {
        schema: 'a1.split-single-clock-comparison/v1',
        scope: 'unit test single-clock split',
        expectedRanges: [[0, 43], [43, 48]],
        pattern: ['candidate', 'pooled'],
        armTimeoutSeconds: 10,
        protectedCacheDirectories: [cacheDir],
        filePins: [{ path: workerFile, bytes: fs.statSync(workerFile).size, sha256: sha256(fs.readFileSync(workerFile)) }],
        workloads: [
          { name: 'w1', classification: 'frozen', prompt: 'p1', promptIds: [1, 2], maxNew: 4, stopIds: [9] },
          { name: 'w2', classification: 'heldout', prompt: 'p2', promptIds: [3, 4], maxNew: 4, stopIds: [9] }
        ],
        arms: {
          candidate: { command: [process.execPath, workerFile, 'candidate'] },
          pooled: { command: [process.execPath, workerFile, 'pooled'] }
        }
      };
      const freezePath = path.join(root, 'freeze-split.json');
      const raw = Buffer.from(JSON.stringify(freeze, null, 2));
      fs.writeFileSync(freezePath, raw);
      const sha = sha256(raw);

      const preflight = await run(process.execPath, [SOURCE, freezePath, '--sha256', sha, '--output', path.join(root, 'preflight-out')],
        { timeout: 10000 });
      expect(JSON.parse(preflight.stdout).metadataPreflightPassed).toBe(true);

      const execOut = path.join(root, 'exec-out');
      await run(process.execPath, [SOURCE, freezePath, '--sha256', sha, '--output', execOut, '--execute'], { timeout: 15000 });
      const report = JSON.parse(fs.readFileSync(path.join(execOut, 'report.json'), 'utf8'));
      expect(report.completed).toBe(true);
      expect(report.arms).toHaveLength(4);
      expect(fs.existsSync(cacheDir)).toBe(false);
      const candidate = report.aggregates.candidate, pooled = report.aggregates.pooled;
      expect(candidate.startupWallMeanMs).toBeLessThan(pooled.startupWallMeanMs);
      expect(candidate.repeatRequestClientMeanMs).toBeLessThan(pooled.repeatRequestClientMeanMs);
      for (const arm of report.arms) {
        const summary = arm.summary;
        expect(summary.openPlusFirstAnswerClientMs).toBeCloseTo(summary.startupWallMs + summary.postOpenFirstRequestClientMs, 5);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 30000);

  it('rejects a mismatched split layer placement', () => {
    expect(() => summarizeSplitArm('w1', 'pooled', 100.0, { split: { ranges: [[0, 40], [40, 48]] }, clientOpenWallMs: 90.0 },
      Array(3).fill({ clientRequestWallMs: 10.0, requestWallMs: 9.0 }), [[0, 43], [43, 48]])).toThrow(AssertionError);
  });
});
