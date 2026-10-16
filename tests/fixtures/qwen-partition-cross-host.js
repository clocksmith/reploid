// Exact-weight cross-host diagnostic. SSH is test transport, not public mesh proof.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { createHash, randomUUID } from 'node:crypto';

const [configPath, outputPath] = process.argv.slice(2);
const configBytes = await fs.readFile(configPath), config = JSON.parse(configBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const baselineBytes = await fs.readFile(config.baselinePath);
assert.equal(sha(baselineBytes), config.baselineSha256);
const baseline = JSON.parse(baselineBytes);
await fs.mkdir(outputPath);
const report = { schema: 'reploid.q4-cross-host/v1', startedAt: new Date().toISOString(),
  scope: 'Doppler resident execution across Mac Metal and AMD Vulkan over private SSH; not Reploid WebRTC or signed release',
  configSha256: sha(configBytes), baselineSha256: sha(baselineBytes), opens: [], rows: [], cleanup: [], passed: false };
const save = () => fs.writeFile(path.join(outputPath, 'report.json'), JSON.stringify(report, null, 2) + '\n');
const workers = [];
async function start(spec, index) {
  const child = spawn(spec.command, spec.args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...spec.env } });
  const pending = new Map(); let serial = 0;
  const log = await fs.open(path.join(outputPath, `worker-${index}.log`), 'wx');
  child.stderr.on('data', bytes => log.write(bytes));
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.on('exit', (code, signal) => {
    log.close();
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(`Stage ${index} exited ${code}/${signal}`)); }
    pending.clear();
  });
  readline.createInterface({ input: child.stdout }).on('line', line => {
    if (!line.startsWith('@q4-response ')) { log.write(line + '\n'); return; }
    const response = JSON.parse(line.slice(13)), request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id); clearTimeout(request.timer);
    if (response.error) request.reject(Object.assign(new Error(response.error.message), { remote: response.error }));
    else request.resolve(response.value);
  });
  const rpc = body => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Stage ${index} deadline exceeded`)); }, config.commandTimeoutMs);
    pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ ...body, id }) + '\n');
  });
  return { rpc, async close() {
    if (child.exitCode !== null) return { alreadyExited: true, code: child.exitCode };
    try { return await rpc({ op: 'close' }); }
    finally { child.stdin.end(); await exited; }
  } };
}
const decode = text => new Float32Array(Uint8Array.from(Buffer.from(text, 'base64')).buffer);
let identity;
try {
  for (const [index, spec] of config.workers.entries()) {
    const worker = await start(spec, index); workers.push(worker);
    const opened = await worker.rpc({ op: 'open', indices: [index] });
    report.opens.push(opened); await save(); console.log(`Stage ${index} ready, weights ${opened.descriptors[0].descriptor.residentWeightBytes}`);
  }
  const opened = report.opens[0];
  assert.deepEqual(report.opens[1].plan, opened.plan);
  assert.deepEqual(report.opens[1].generation, opened.generation);
  identity = { schema: 'doppler.resident-partition-attempt/v2', modelId: opened.model.id,
    modelIdentity: opened.model.identity, planId: opened.planId, threadId: 'capitals55', attemptId: randomUUID(),
    requesterId: 'private-cross-host-control', placementGeneration: 0,
    stages: [0, 1].map(index => ({ index, participantId: 'q4-stage-' + index,
      transportId: 'owned-ssh-' + index, residentId: 'resident-' + index, executionId: 'q4-cross-host-' + index })) };
  let input = baseline.ids, position = 0;
  const continuations = [null, null];
  const runStarted = performance.now();
  for (let step = 0; step < baseline.rows.length; step++) {
    const params = { identity, step, tokenPosition: position, inputTokenCount: input.length, inputTokenIds: input,
      maxTokens: opened.generation.maxTokens, generation: opened.generation, generationDigest: opened.generationDigest };
    const began = performance.now();
    const a = await workers[0].rpc({ op: 'step', index: 0, parameters: { ...params, continuation: continuations[0] } });
    continuations[0] = a.continuation;
    const b = await workers[1].rpc({ op: 'step', index: 1, parameters: { ...params, continuation: continuations[1] }, activation: a.activation });
    continuations[1] = b.continuation;
    const elapsedMs = performance.now() - began;
    const actual = decode(b.logits), expected = decode(baseline.rows[step].logits);
    assert.equal(actual.length, expected.length);
    let maxAbs = 0, squared = 0;
    for (let i = 0; i < actual.length; i++) {
      assert(Number.isFinite(actual[i]) && Number.isFinite(expected[i]));
      const error = Math.abs(actual[i] - expected[i]); maxAbs = Math.max(maxAbs, error); squared += error * error;
    }
    report.rows.push({ step, maxAbs, rms: Math.sqrt(squared / actual.length), tokenId: b.tokenId,
      referenceTokenId: baseline.rows[step].tokenId, delta: b.delta, elapsedMs, metrics: [a.metrics, b.metrics],
      activationSha256: sha(Buffer.from(a.activation.buffer, 'base64')) });
    await save();
    if (b.tokenId !== baseline.rows[step].tokenId) {
      await fs.writeFile(path.join(outputPath, `divergent-${step}.f32`), Buffer.from(b.logits, 'base64'));
      throw new Error(`Different selected token at shared prefix ${step}; do not compare subsequent free-running states`);
    }
    position += input.length; input = [b.tokenId];
    if ((step + 1) % 10 === 0) console.log(`${step + 1} steps, maxAbs ${maxAbs}`);
  }
  report.diagnosticElapsedMs = performance.now() - runStarted;
  report.passed = report.rows.length === config.requiredSteps && report.rows.every(row => row.maxAbs <= config.maxAbsoluteLogitError);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.error = { message: error.message, stack: error.stack, remote: error.remote }; process.exitCode = 1;
} finally {
  for (const worker of workers) {
    try { if (identity) await worker.rpc({ op: 'retire', identity }); }
    catch (error) { report.cleanup.push({ operation: 'retire', error: error.message }); report.passed = false; process.exitCode = 1; }
    try { report.cleanup.push(await worker.close()); }
    catch (error) { report.cleanup.push({ operation: 'close', error: error.message }); report.passed = false; process.exitCode = 1; }
  }
  report.finishedAt = new Date().toISOString(); await save(); console.log(JSON.stringify({ passed: report.passed, error: report.error?.message }));
}
