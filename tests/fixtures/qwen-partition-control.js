// Same-host control for the explicitly frozen Q4 partition experiment.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { createHash, randomUUID } from 'node:crypto';

const [configPath, contractPath, outputPath] = process.argv.slice(2);
await fs.mkdir(outputPath);
const contractBytes = await fs.readFile(contractPath), configBytes = await fs.readFile(configPath);
const contract = JSON.parse(contractBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { schema: 'reploid.q4-partition-control/v1', startedAt: new Date().toISOString(),
  scope: 'Native same-device control; not public or cross-host qualification',
  configSha256: hash(configBytes), contractSha256: hash(contractBytes), opens: [], cases: [], cleanup: [], passed: false };
const save = () => fs.writeFile(path.join(outputPath, 'report.json'), JSON.stringify(report, null, 2) + '\n');
let child, childExited, pending = new Map(), serial = 0;
async function start() {
  child = spawn(process.execPath, [new URL('./qwen-partition-worker.js', import.meta.url).pathname, configPath],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  const log = await fs.open(path.join(outputPath, `worker-${report.opens.length}.log`), 'wx');
  child.stderr.on('data', value => log.write(value));
  readline.createInterface({ input: child.stdout }).on('line', line => {
    if (!line.startsWith('@q4-response ')) { log.write(line + '\n'); return; }
    const response = JSON.parse(line.slice(13)), waiting = pending.get(response.id);
    if (!waiting) return;
    clearTimeout(waiting.timer); pending.delete(response.id);
    if (response.error) waiting.reject(Object.assign(new Error(response.error.message), { remote: response.error }));
    else waiting.resolve(response.value);
  });
  childExited = new Promise(resolve => child.once('exit', resolve));
  child.on('exit', (code, signal) => {
    log.close();
    for (const waiting of pending.values()) { clearTimeout(waiting.timer); waiting.reject(new Error(`Worker exited ${code}/${signal}`)); }
    pending.clear();
  });
}
function rpc(body) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Diagnostic command deadline exceeded')); }, contract.commandTimeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ ...body, id }) + '\n');
  });
}
async function retireWorker() {
  if (!child || child.exitCode !== null) return;
  try { report.cleanup.push(await rpc({ op: 'close' })); }
  finally { child.stdin.end(); await childExited; }
}
const decode = text => new Float32Array(Uint8Array.from(Buffer.from(text, 'base64')).buffer);
try {
  await start();
  report.opens.push({ mode: 'whole', ...await rpc({ op: 'open', indices: null }) });
  console.log('whole opened'); await save();
  for (const item of contract.cases) {
    const baseline = await rpc({ op: 'whole', prompt: item.prompt });
    await fs.writeFile(path.join(outputPath, item.id + '-whole.json'), JSON.stringify(baseline));
    report.cases.push({ id: item.id, whole: { ids: baseline.ids, tokens: baseline.rows.map(row => row.tokenId),
      text: baseline.text, elapsedMs: baseline.elapsedMs, memory: baseline.memory } });
    console.log(`whole ${item.id}: ${baseline.rows.length} tokens`); await save();
  }
  await retireWorker(); await start();
  const opened = await rpc({ op: 'open', indices: [0, 1] });
  report.opens.push({ mode: 'local-split', ...opened }); console.log('local partitions opened'); await save();
  for (const item of contract.cases) {
    const baseline = JSON.parse(await fs.readFile(path.join(outputPath, item.id + '-whole.json')));
    const identity = { schema: 'doppler.resident-partition-attempt/v2', modelId: opened.model.id,
      modelIdentity: opened.model.identity, planId: opened.planId, threadId: item.id, attemptId: randomUUID(),
      requesterId: 'private-control', placementGeneration: 0,
      stages: [0, 1].map(index => ({ index, participantId: 'q4-stage-' + index,
        transportId: 'same-process-' + index, residentId: 'resident-' + index, executionId: 'q4-control-' + index })) };
    const rows = [], continuations = [null, null];
    let input = baseline.ids, position = 0;
    const start = performance.now();
    try {
      for (let step = 0; step < baseline.rows.length; step++) {
        const params = { identity, step, tokenPosition: position, inputTokenCount: input.length,
          inputTokenIds: input, maxTokens: opened.generation.maxTokens,
          generation: opened.generation, generationDigest: opened.generationDigest };
        const a = await rpc({ op: 'step', index: 0, parameters: { ...params, continuation: continuations[0] } });
        continuations[0] = a.continuation;
        const b = await rpc({ op: 'step', index: 1, parameters: { ...params, continuation: continuations[1] }, activation: a.activation });
        continuations[1] = b.continuation;
        const actual = decode(b.logits), expected = decode(baseline.rows[step].logits);
        assert.equal(actual.length, expected.length);
        let maxAbs = 0, squared = 0;
        for (let i = 0; i < actual.length; i++) {
          assert(Number.isFinite(actual[i]) && Number.isFinite(expected[i]));
          const error = Math.abs(actual[i] - expected[i]); maxAbs = Math.max(maxAbs, error); squared += error * error;
        }
        rows.push({ step, maxAbs, rms: Math.sqrt(squared / actual.length), tokenId: b.tokenId,
          referenceTokenId: baseline.rows[step].tokenId, metrics: [a.metrics, b.metrics],
          activationSha256: hash(Buffer.from(a.activation.buffer, 'base64')) });
        if (b.tokenId !== baseline.rows[step].tokenId) throw new Error(`Shared-prefix comparison stops at token divergence ${step}; subsequent free-running states are not comparable`);
        position += input.length; input = [b.tokenId];
        if ((step + 1) % 10 === 0) console.log(`${item.id}: ${step + 1} steps, maxAbs ${maxAbs}`);
      }
    } finally {
      const row = report.cases.find(row => row.id === item.id);
      row.split = { rows, elapsedMs: performance.now() - start, memory: await rpc({ op: 'retire', identity }),
        passed: rows.length === baseline.rows.length && rows.every(row => row.maxAbs <= contract.maxAbsoluteLogitError) };
      await save();
    }
  }
  report.passed = report.cases.every(row => row.split.passed);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.error = { message: error.message, stack: error.stack, remote: error.remote }; process.exitCode = 1;
} finally {
  try { await retireWorker(); } catch (error) { report.cleanupError = error.message; report.passed = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); await save();
  console.log(JSON.stringify({ passed: report.passed, error: report.error?.message }));
}
