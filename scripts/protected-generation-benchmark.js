#!/usr/bin/env node
/**
 * Run the frozen ticket triage task through Doppler's plaintext and one real CKKS WebGPU evaluator.
 * The local driver starts separate loopback-only evaluator, peer, trap oracle and key-holder processes.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createInference } from '../shared/vendor/reploid/inference/index.js';
import { openDopplerKeyHolder } from '../server/protected-route/doppler-key-holder.js';
import { startDopplerEvaluator } from '../server/protected-route/doppler-evaluator.js';
import { compileDopplerProgram, resolveDopplerProtected, runDopplerTool } from '../server/protected-route/doppler-tooling.js';
import { connectFrameSocket } from '../server/protected-route/frame-socket.js';
import { createNodeProtectedExecution } from '../server/protected-route/requester-host.js';

const { values } = parseArgs({ options: {
  doppler: { type: 'string' }, cases: { type: 'string' }, report: { type: 'string', default: 'protected-generation-benchmark.json' }
} });
const secondsSince = start => (performance.now() - start) / 1000;
const rssPeak = () => process.resourceUsage().maxRSS * 1024;
const maximum = rows => rows.length ? Math.max(...rows) : null;
const ciphertextBytes = blobs => blobs.reduce((bytes, blob) => bytes + blob.byteLength, 0);
const frameBytes = frame => 4 + Buffer.byteLength(JSON.stringify(frame.header)) + ciphertextBytes(frame.blobs);
const report = { schema: 'reploid.protected-generation-benchmark/v1', scope: null, protocol: {
  protection: 'homomorphic', requestWeightsDownloadedBytes: 0, requesterAssistedDecode: true,
  securityReview: 'unreviewed', trapChecks: 'diagnostic', transport: 'signed TCP on loopback'
}, cases: [], gates: {} };

async function startService(file, args, readyFile, register) {
  const child = spawn(process.execPath, [file, ...args, '--ready-file', readyFile], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '', failure;
  child.stderr.on('data', text => { stderr = (stderr + text).slice(-4096); });
  child.once('error', error => { failure = error; });
  const done = new Promise(resolve => child.once('close', resolve));
  register({ child, done });
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline && !failure && child.exitCode === null) {
    const ready = await readFile(readyFile, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    if (ready) return ready;
    await delay(40);
  }
  throw new Error(`Service ${path.basename(file)} did not start: ${failure?.message ?? stderr.trim()}`);
}

async function measuredChannel(endpoint, options, metrics) {
  const channel = await connectFrameSocket(endpoint, options);
  return {
    ...channel,
    async send(frame) {
      await channel.send(frame);
      const bytes = frameBytes(frame);
      metrics.wireBytesSent += bytes;
      if (frame.header.kind === 'key') metrics.keyWireBytes += bytes;
      if (frame.header.kind === 'step') metrics.steps.at(-1).requestWireBytes = bytes;
    },
    async receive(settings) {
      const frame = await channel.receive(settings);
      const bytes = frameBytes(frame);
      metrics.wireBytesReceived += bytes;
      if (frame.header.kind === 'result') metrics.steps.at(-1).resultWireBytes = bytes;
      return frame;
    }
  };
}

function measuredKeyHolder(base, run) {
  let step;
  return {
    ...base,
    async generateKeys(send) {
      run.keyStartedAt = performance.now();
      return base.generateKeys(async blob => {
        run.keyBytes += blob.byteLength;
        const t = performance.now();
        await send(blob);
        run.keySendSeconds += secondsSince(t);
      });
    },
    async commitKeys(digest) {
      await base.commitKeys(digest);
      run.keyScheduleSeconds = secondsSince(run.keyStartedAt);
    },
    async encrypt(tokens) {
      const start = performance.now();
      const blobs = await base.encrypt(tokens);
      step = { step: run.steps.length + 1, start, inputTokensAcrossLanes: tokens.length,
        ciphertextBytesIn: ciphertextBytes(blobs), ciphertextBytesOut: 0, encryptSeconds: secondsSince(start), decryptSeconds: 0 };
      run.steps.push(step);
      return blobs;
    },
    async decrypt(blob) {
      const start = performance.now();
      const logits = await base.decrypt(blob);
      step.decryptSeconds += secondsSince(start);
      step.lastDecryptionAt = performance.now();
      step.ciphertextBytesOut += blob.byteLength;
      // The signed route checks traps first, then decrypts the real lane last. This is benchmark-only, local data.
      step.logits = logits ? [...logits] : null;
      return logits;
    },
    async close() {
      const stats = await base.close();
      run.keyHolderPeakRssBytes = stats?.peakRssBytes ?? null;
      return stats;
    }
  };
}

async function benchmarkCase({ row, index, plain, inference, peer, metrics }) {
  const begun = performance.now();
  const plan = await inference.prepare({
    model: { id: plain.task, identity: plain.model },
    generation: { maxOutputTokens: plain.limits.generatedTokens },
    execution: { protection: 'homomorphic', route: 'remote', participants: { kind: 'named', ids: [peer.participantId] },
      allowMetadata: ['model-id', 'timing', 'length'] }
  });
  const handle = await inference.run({ planId: plan.id, requestId: `ticket-triage-${index}`,
    input: { messages: [{ role: 'user', content: row.prompt.join(' ') }] } });
  let firstTokenSeconds = null;
  const emissions = [];
  for await (const event of handle.events) {
    if (event.type !== 'output.delta') continue;
    const at = performance.now();
    firstTokenSeconds ??= (at - begun) / 1000;
    emissions.push(at);
  }
  const result = await handle.result;
  const words = plain.tokenizer.words;
  const output = result.output?.text?.split(' ').map(word => words.indexOf(word)) ?? [];
  const steps = metrics.steps.map((step, i) => {
    const comparable = i === 0 || output.slice(0, i).every((token, j) => token === row.approximate.output[j]);
    const logits = step.logits ?? [];
    const reference = row.approximate.logits[i];
    const maxLogitError = comparable && logits.length === reference.length && logits.every(Number.isFinite)
      ? maximum(logits.map((x, j) => Math.abs(x - reference[j]))) : null;
    const { start, lastDecryptionAt, logits: localLogits, ...timing } = step;
    return { ...timing, maxLogitError, nonFiniteLogits: localLogits?.filter(x => !Number.isFinite(x)).length ?? null,
      seconds: emissions[i] === undefined ? null : (emissions[i] - start) / 1000,
      sampleAndEmitSeconds: emissions[i] === undefined || lastDecryptionAt === undefined
        ? null : (emissions[i] - lastDecryptionAt) / 1000 };
  });
  return { prompt: row.prompt, expected: row.expected.map(i => words[i]), output: output.map(i => words[i]), status: result.status,
    error: result.error ?? null, peer: plan.route.participants[0], correct: row.expected.every((token, i) => output[i] === token),
    firstTokenSeconds, decodeSecondsPerToken: emissions.slice(1).map((at, i) => (at - emissions[i]) / 1000),
    coldEvaluationKeyBytes: metrics.keyBytes, keySendSeconds: metrics.keySendSeconds, keyScheduleSeconds: metrics.keyScheduleSeconds ?? null,
    keyWireBytes: metrics.keyWireBytes, wireBytesSent: metrics.wireBytesSent, wireBytesReceived: metrics.wireBytesReceived,
    keyHolderPeakRssBytes: metrics.keyHolderPeakRssBytes ?? null, steps, receipt: result.executionReceipt };
}

async function run() {
  if (!values.doppler) throw new Error('Usage: node scripts/protected-generation-benchmark.js --doppler <checkout> [--report file] [--cases n]');
  const doppler = path.resolve(values.doppler);
  const plain = await runDopplerTool(doppler, ['triage-plaintext']);
  const { rows, ...plaintext } = plain;
  report.plaintext = plaintext;
  report.gates.plaintext = plain.passed;
  if (!plain.passed) throw new Error('The frozen plaintext gate failed; WebGPU was not opened');
  const count = values.cases === undefined ? rows.length : Number(values.cases);
  if (!Number.isSafeInteger(count) || count < 1 || count > rows.length) throw new Error(`--cases must be between 1 and ${rows.length}`);
  report.scope = count === rows.length ? 'full-holdout' : 'diagnostic-subset';
  const dir = await mkdtemp(path.join(tmpdir(), 'reploid-ckks-triage-'));
  const file = name => path.join(dir, name);
  const children = [];
  const register = child => children.push(child);
  let evaluator;
  try {
    const programPath = file('program');
    await compileDopplerProgram({ doppler, profile: plain.profile, promptTokens: plain.limits.promptTokens,
      generatedTokens: plain.limits.generatedTokens, out: programPath, triage: true });
    const program = JSON.parse(await readFile(programPath + '.json', 'utf8'));
    if (program.circuit !== plain.circuit || program.model !== plain.model || program.profileDigest !== plain.profileDigest) {
      throw new Error('Compiled program differs from the plaintext pins');
    }
    report.program = { constantsDigest: program.blobDigest, constantBytes: program.blobWords * 4,
      inputLevel: plain.inputLevel, steps: program.steps.map(step => ({ kind: step.kind, outputLevel: step.outputLevel,
        multiplicationLevelsConsumed: plain.inputLevel - step.outputLevel,
        cacheBefore: (step.stateIn ?? []).map(({ name, reg }) => ({ name, ...program.regs[reg] })),
        cacheAfter: (step.stateOut ?? []).map(({ name, reg }) => ({ name, ...program.regs[reg] })) })) };
    evaluator = await startDopplerEvaluator({ doppler, programs: [programPath], maxLanes: 2, sessions: count, report: file('gpu-report.json'),
      log: line => { if (line.includes('error:')) console.error(line); } });
    const { tools } = resolveDopplerProtected(doppler);
    const oracleAddress = await startService(path.join(tools, 'trap-oracle.js'),
      ['--triage', '--key', file('oracle.key'), '--new-key', '--tolerance', String(plain.limits.maxCkksLogitError), '--min-margin', '0.2'],
      file('oracle-ready'), register);
    const oracle = `http://${oracleAddress}`;
    const descriptor = await (await fetch(new URL('/v1/descriptor', oracle), { signal: AbortSignal.timeout(10_000) })).json();
    if (descriptor.circuit !== plain.circuit || descriptor.model !== plain.model) throw new Error('The trap oracle serves a different circuit');
    const peer = JSON.parse(await startService(fileURLToPath(new URL('../server/protected-route/evaluator-peer.js', import.meta.url)), [
      '--doppler', doppler, '--triage', '--profile', plain.profile, '--evaluator', evaluator.address, '--max-lanes', '2', '--identity-file', file('peer.json')
    ], file('peer-ready'), register));

    const { profile, profileDigest, insecureDevelopment, circuit, model, tokenizer, vocab, context, inputLevel, logSlots, rotations } = plain;
    const policy = {
      protocols: ['reploid.protected-generation/v1'], engines: [plain.protocol], allowInsecureDevelopment: false, allowPublicTrapSet: false,
      parameterSets: [{ id: profile, digest: profileDigest, insecureDevelopment }],
      circuits: [{ identity: circuit, modelIdentity: model, tokenizer, vocab, context, inputLevel, logSlots, rotations,
        traps: { source: 'oracle', endpoint: oracle, oracleKeys: [descriptor.oracleKey] } }],
      trapLanes: 1, maxTrapTolerance: plain.limits.maxCkksLogitError, maxKeyEpochSeconds: 86_400
    };
    const noPlaintext = () => { throw new Error('The benchmark does not permit a plaintext route'); };
    let metrics;
    const protectedExecution = createNodeProtectedExecution({
      endpoints: [peer.endpoint], policy, stateDir: file('requester-epoch'), unreviewedProtectedExecution: true,
      connect: (endpoint, options) => measuredChannel(endpoint, options, metrics),
      openKeyHolder: async settings => measuredKeyHolder(await openDopplerKeyHolder({ doppler, ...settings }), metrics)
    });
    const inference = createInference({ resolveRoute: noPlaintext, execute: noPlaintext, protectedExecution, unreviewedProtectedExecution: true });
    for (const [index, row] of rows.slice(0, count).entries()) {
      metrics = { steps: [], keyBytes: 0, keySendSeconds: 0, keyWireBytes: 0, wireBytesSent: 0, wireBytesReceived: 0 };
      const result = await benchmarkCase({ row, index, plain, inference, peer, metrics });
      report.cases.push(result);
      console.error(`CKKS ${index + 1}/${count}: ${result.status}${result.error ? ' ' + result.error.code : ''}`);
      if (result.status !== 'completed') throw new Error(result.error?.message ?? 'Protected generation failed');
    }
    const gpuExit = await evaluator.done;
    if (gpuExit.code !== 0) throw new Error('The WebGPU evaluator did not exit successfully');
    const gpu = JSON.parse(await readFile(file('gpu-report.json'), 'utf8'));
    report.evaluator = gpu;
    report.requester = { peakRssBytes: rssPeak(), keyHolderPeakRssBytes: maximum(report.cases.map(row => row.keyHolderPeakRssBytes).filter(Number.isFinite)) };
    const completed = report.cases.filter(row => row.correct).length;
    const steps = report.cases.flatMap(row => row.steps);
    const maxLogitError = maximum(steps.map(step => step.maxLogitError).filter(Number.isFinite));
    const maxWarmDecodeBytes = maximum(steps.filter(step => step.step > 1).map(step => step.requestWireBytes + step.resultWireBytes).filter(Number.isFinite));
    const quality = completed / count;
    report.encrypted = { completed, count, quality, maxLogitError, maxWarmDecodeBytes };
    report.gates = { plaintext: true, webgpu: gpu.backend === 'webgpu' && gpu.outcome === 'completed'
        && gpu.sessions.length === count && gpu.sessions.every(session => session.outcome === 'completed'),
      quality: quality >= plain.limits.qualityFloor && plaintext.approximate.score - quality <= plain.limits.maxQualityDrop,
      numerics: steps.length === count * plain.limits.generatedTokens && steps.every(step => step.maxLogitError !== null
        && step.maxLogitError <= plain.limits.maxCkksLogitError),
      bytes: maxWarmDecodeBytes !== null && maxWarmDecodeBytes <= plain.limits.warmByteTarget,
      keyReuse: count === 1 ? null : report.cases[0].coldEvaluationKeyBytes > 0 && report.cases.slice(1).every(row => row.coldEvaluationKeyBytes === 0) };
    if (Object.values(report.gates).includes(false)) throw new Error('The benchmark missed a measurement gate');
  } finally {
    for (const { child } of children) child.kill('SIGTERM');
    await Promise.allSettled(children.map(({ done }) => done));
    if (evaluator?.child.exitCode === null) {
      evaluator.stop();
      await evaluator.done;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

try {
  await run();
} catch (error) {
  report.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await writeFile(values.report, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
