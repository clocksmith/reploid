#!/usr/bin/env node
/**
 * Supervisor for one stage of a homomorphic split (Doppler `tools/privacy-protected/webgpu/evaluator.js --role
 * stage-a | stage-b`, branch `protected-he-split`).
 *
 * It holds the stage's signing identity, runs the WebGPU evaluator as a child with `--gate`, and signs this stage's
 * settlement records with the same signers every Reploid stage uses: its acceptance of the requester's terms, a
 * cumulative stage receipt (`reploid.stage-receipt/v1`) per step, and a closing receipt. Beside them it signs a delivery
 * record per step (`reploid.he-split-delivery/v1`): the step, the digests and sizes of the ciphertexts the stage received
 * and sent, its GPU time and dispatch count, and a running SHA-256 over every output digest. It enforces K: the evaluator
 * computes step s only after the requester's signed acknowledgment of at least s - K outputs, forwarded here, verified.
 *
 * It never sees a ciphertext or a key: the requester and the other stage connect to the evaluator directly.
 *
 *   node stage-agent.js --session          JSON lines on stdin/stdout: { id, op, body } -> { id, result | error }
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import readline from 'node:readline';
import { createPeerIdFromPublicJwk } from '../../packages/reploid/src/artifacts/identity.js';
import { createAttemptEvidenceSigner, openStageReceipts, MAX_UNACKNOWLEDGED_OUTPUTS } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { acceptSettlementTerms } from '../../server/fleet/settlement-terms.js';

export const HE_DELIVERY_SCHEMA = 'reploid.he-split-delivery/v1';
const iso = ms => new Date(ms).toISOString();

async function readIdentity(file) {
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw Error('identity-unavailable: a private identity file is required');
  const identity = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!identity.privateJwk || await createPeerIdFromPublicJwk(identity.publicJwk) !== identity.peerId) throw Error('identity-unavailable: the identity file is invalid');
  return identity;
}

/** One agent: an identity, at most one evaluator child and at most one charged attempt. */
export function createStageAgent({ spawnEvaluator = (command, args, options) => spawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] }), now = Date.now } = {}) {
  let identity = null, signer = null, child = null, receipts = null, attempt = null, closing = null, role = null;
  const records = [], deliveries = [], log = [];
  let waiting = null, exited = null, transcript = createHash('sha256').digest('hex'), sampler = null;
  const memory = { peakRssBytes: 0, samples: 0 };
  // Peak resident memory of the evaluator (Linux /proc; on unified-memory GPUs this includes the GPU buffers).
  const sample = async () => {
    const text = await fs.readFile(`/proc/${child?.pid}/status`, 'utf8').catch(() => '');
    const kb = Number(/VmHWM:\s+(\d+)/.exec(text)?.[1] ?? 0);
    if (kb) { memory.peakRssBytes = Math.max(memory.peakRssBytes, kb * 1024); memory.samples += 1; }
  };
  const acknowledged = () => receipts?.evidence().acknowledged?.acknowledgment.count ?? 0;
  // A waiting step goes ahead once the verified acknowledgments cover step - K; nothing else releases it. The
  // evaluator's step numbers are 1-based (step s produces output s - 1).
  const release = () => {
    if (waiting === null || !receipts || !child) return;
    if (acknowledged() >= waiting - 1 - MAX_UNACKNOWLEDGED_OUTPUTS) { child.stdin.write(`GO ${waiting}\n`); waiting = null; }
  };
  const onStep = async line => {
    const step = JSON.parse(line);
    if (!receipts) { log.push({ at: iso(now()), note: 'step before charge', step: step.step }); return; }
    const receipt = await receipts.step({ step: step.step, inputTokenCount: step.columns });
    if (receipt) records.push(receipt);
    transcript = createHash('sha256').update(transcript).update(step.outputDigest).digest('hex');
    const body = { schema: HE_DELIVERY_SCHEMA, reservationId: receipts.reservationId, attemptId: attempt.attemptId, routeHash: receipts.routeHash,
      partitionIndex: attempt.partitionIndex, participantId: signer.participantId, stage: role, step: step.step, kind: step.kind, position: step.position,
      columns: step.columns, input: { digest: step.inputDigest, bytes: step.bytesIn }, output: { digest: step.outputDigest, bytes: step.bytesOut },
      gpuProgramMs: step.gpuProgramMs, computeSeconds: step.computeSeconds, dispatches: step.dispatches, layers: step.layers,
      transcript: 'sha256:' + transcript, signedAt: iso(now()) };
    deliveries.push(await signer.sign(HE_DELIVERY_SCHEMA, body));
  };
  let stepQueue = Promise.resolve();
  const ops = {
    async identity({ file }) {
      identity = await readIdentity(file);
      signer = createAttemptEvidenceSigner({ identity, now });
      return { participantId: identity.peerId, publicJwk: identity.publicJwk };
    },
    /** Start the evaluator for this stage and wait until it listens. */
    async open({ command, cwd, args, stage }) {
      if (child) throw Error('An evaluator is already running');
      if (!['stage-a', 'stage-b'].includes(stage)) throw Error('stage must be stage-a or stage-b');
      role = stage;
      child = spawnEvaluator(command[0], [...command.slice(1), ...args, '--role', stage, '--gate', '--sessions', '1'], { cwd });
      exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
      sampler = setInterval(sample, 500);
      exited.then(() => clearInterval(sampler));
      const ready = new Promise((resolve, reject) => {
        readline.createInterface({ input: child.stdout }).on('line', line => {
          if (line.startsWith('READY ')) resolve(line.slice(6));
          else if (line.startsWith('STEP ')) stepQueue = stepQueue.then(() => onStep(line.slice(5))).catch(error => log.push({ at: iso(now()), error: String(error?.message ?? error) }));
          else if (line.startsWith('WAIT ')) stepQueue = stepQueue.then(() => { waiting = Number(line.slice(5)); release(); });
        });
        exited.then(status => reject(Error(`evaluator exited before it was ready: ${JSON.stringify(status)}`)));
      });
      readline.createInterface({ input: child.stderr }).on('line', line => {
        if (log.length < 400 && !/artificially reduced/.test(line)) log.push({ at: iso(now()), evaluator: line.slice(0, 300) });
      });
      return { listening: await ready, pid: child.pid };
    },
    accept: async ({ terms, partitionIndex }) => {
      const acceptance = await acceptSettlementTerms({ signer, terms, partitionIndex, now });
      records.push(acceptance);
      return acceptance;
    },
    /** The requester's charge binding (its signed zero acknowledgment) opens this stage's receipts for the attempt. */
    async charge({ identity: binding, partitionIndex, charge }) {
      receipts = await openStageReceipts({ signer, identity: binding, partitionIndex, charge, now, textlessOutputs: true });
      attempt = { attemptId: binding.attemptId, partitionIndex };
      release();
      return { reservationId: receipts.reservationId, routeHash: receipts.routeHash };
    },
    async ack({ acknowledged: pair }) {
      const kept = await receipts.acknowledge(pair);
      release();
      return { kept, acknowledged: acknowledged() };
    },
    /** Failure injection for the failure case: the evaluator process dies mid-answer. */
    async kill() { child?.kill('SIGKILL'); return { killed: Boolean(child) }; },
    /** Close this stage: settled, or failed when the evaluator died or the attempt failed. */
    async close({ failed = false } = {}) {
      closing ??= (async () => {
        const status = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(null), 5000))]);
        await stepQueue;
        const died = Boolean(status && (status.signal || status.code !== 0));
        if (child && !status) { child.stdin.end(); child.kill('SIGTERM'); }
        // As in the secret-shared supervisor: a `failed` close names no cause, so an unfinished answer settles as an
        // unattributed disconnect (the acknowledged prefix) under the decided rules.
        const receipt = receipts ? await receipts.close({ failed: failed || died }) : null;
        if (receipt) records.push(receipt);
        clearInterval(sampler);
        return { receipt, evaluatorExit: status, died, closed: Boolean(receipt), memory: { ...memory } };
      })();
      return closing;
    },
    /** The evaluator's own report (sizes, timings, digests; never values), for the receipt. */
    async report({ file }) { return JSON.parse(await fs.readFile(file, 'utf8').catch(() => 'null')); },
    records: async () => ({ records: structuredClone(records), deliveries: structuredClone(deliveries), log: structuredClone(log) }),
    evidence: async () => receipts?.evidence() ?? null
  };
  return { ops, stop: () => { try { child?.kill('SIGKILL'); } catch { /* gone */ } } };
}

async function session() {
  const agent = createStageAgent();
  const reply = value => process.stdout.write(JSON.stringify(value) + '\n');
  reply({ event: 'agent', pid: process.pid });
  const lines = readline.createInterface({ input: process.stdin });
  for await (const line of lines) {
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.op === 'exit') { agent.stop(); reply({ id: message.id, result: true }); break; }
    const run = agent.ops[message.op];
    Promise.resolve().then(() => { if (!run) throw Error(`unknown op ${message.op}`); return run(message.body ?? {}); })
      .then(result => reply({ id: message.id, result }), error => reply({ id: message.id, error: String(error?.message ?? error) }));
  }
  agent.stop();
  process.exit(0);
}

if (process.argv[2] === '--session') await session();
else if (process.argv[1]?.endsWith('stage-agent.js')) { process.stderr.write('usage: stage-agent.js --session\n'); process.exitCode = 2; }
