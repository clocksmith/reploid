#!/usr/bin/env node
/**
 * Supervisor for one share operator of a secret-shared split (Doppler `tools/secret-shared/gpu/operator-gpu.js`).
 *
 * It holds the operator's signing identity, runs the JavaScript operator (e.g. Doppler's `tools/secret-shared/gpu/operator-gpu.js`)
 * under this Node binary as a child with `--gate` (Reploid runs JavaScript only; a Go operator binary is refused), and signs this share's
 * settlement records with the same signers every Reploid stage uses: its acceptance of the requester's terms, a
 * cumulative stage receipt (`reploid.stage-receipt/v1`) per step, and a closing receipt. Beside them it signs a delivery
 * record per step (`reploid.secret-shared-delivery/v1`): rounds, columns, multiply-accumulates, bytes, and the running
 * SHA-256 over every output share it returned. It enforces K: the operator computes step s only after the requester's
 * signed acknowledgment of at least s - K outputs, forwarded here, has verified.
 *
 * It never sees a share: the requester connects to the operator directly over its own encrypted link.
 *
 *   node share-agent.js --session          JSON lines on stdin/stdout: { id, op, body } -> { id, result | error }
 *   node share-agent.js --init-identity FILE   creates a private Ed25519 identity once (an operator enrollment step)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { createPeerIdFromPublicJwk, createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createAttemptEvidenceSigner, openStageReceipts, MAX_UNACKNOWLEDGED_OUTPUTS } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { acceptSettlementTerms } from '../../server/fleet/settlement-terms.js';

export const DELIVERY_SCHEMA = 'reploid.secret-shared-delivery/v1';
const iso = ms => new Date(ms).toISOString();

async function readIdentity(file) {
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) throw Error('identity-unavailable: a private identity file is required');
  const identity = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!identity.privateJwk || await createPeerIdFromPublicJwk(identity.publicJwk) !== identity.peerId) throw Error('identity-unavailable: the identity file is invalid');
  return identity;
}

/** One agent: an identity, at most one operator child and at most one charged attempt. */
export function createShareAgent({ spawnOperator = (command, args, env) => spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] }), now = Date.now } = {}) {
  let identity = null, signer = null, child = null, receipts = null, attempt = null, closing = null;
  const records = [], deliveries = [], log = [];
  let waiting = null, exited = null, ready = null, frozen = null;
  const acknowledged = () => receipts?.evidence().acknowledged?.acknowledgment.count ?? 0;
  // A waiting step goes ahead once the verified acknowledgments cover step - K; nothing else releases it.
  const release = () => {
    if (waiting === null || !receipts || !child) return;
    if (acknowledged() >= waiting - MAX_UNACKNOWLEDGED_OUTPUTS) { child.stdin.write(`GO ${waiting}\n`); waiting = null; }
  };
  const onStep = async line => {
    const step = JSON.parse(line);
    if (!receipts) { log.push({ at: iso(now()), note: 'step before charge', step: step.step }); return; }
    const receipt = await receipts.step({ step: step.step, inputTokenCount: step.columns });
    if (receipt) records.push(receipt);
    const body = { schema: DELIVERY_SCHEMA, reservationId: receipts.reservationId, attemptId: attempt.attemptId, routeHash: receipts.routeHash,
      partitionIndex: attempt.partitionIndex, participantId: signer.participantId, stage: attempt.stage, share: attempt.share, step: step.step,
      rounds: step.rounds, columns: step.columns, macs: step.macs, outputBytes: step.bytesOut, transcript: 'sha256:' + step.transcript, signedAt: iso(now()) };
    deliveries.push(await signer.sign(DELIVERY_SCHEMA, body));
  };
  let stepQueue = Promise.resolve();
  const ops = {
    async identity({ file }) {
      identity = await readIdentity(file);
      signer = createAttemptEvidenceSigner({ identity, now });
      return { participantId: identity.peerId, publicJwk: identity.publicJwk, host: os.hostname().length > 0 };
    },
    /**
     * Start the operator child for one stage share and wait until it listens. `node` is the command that runs Node for
     * the operator (default: this agent's own Node), for hosts whose GPU binding needs a loader wrapper around Node; the
     * operator is still the JavaScript script.
     */
    async open({ operatorScript, plan, modelDirectory, stage, share, listen, connect, device = 'cpu', threads = 0, token, workDirectory, node = null }) {
      if (child) throw Error('An operator is already running');
      if (!/\.m?js$/.test(operatorScript ?? '')) throw Error('operator-refused: the operator must be a JavaScript script (.js/.mjs); Reploid runs JavaScript only');
      await fs.mkdir(workDirectory, { recursive: true });
      const planFile = path.join(workDirectory, `plan-${stage}-${share}.json`);
      await fs.writeFile(planFile, plan);
      if ((listen === undefined) === (connect === undefined)) throw Error('operator-refused: give the operator exactly one of listen or connect');
      if (!['cpu', 'gpu'].includes(device)) throw Error('operator-refused: device is cpu or gpu');
      if (node !== null && (!Array.isArray(node) || node.length === 0 || !node.every(part => typeof part === 'string' && part.length > 0))) {
        throw Error('operator-refused: node is a non-empty command array that runs Node');
      }
      const [command, ...prefix] = node ?? [process.execPath];
      // --connect: the operator dials the requester (hosts that accept no inbound connections); the protocol is unchanged.
      child = spawnOperator(command, [...prefix, operatorScript, '--plan', planFile, '--model-dir', modelDirectory, '--stage', String(stage), '--share', String(share),
        ...(connect !== undefined ? ['--connect', connect] : ['--listen', listen]), '--device', device, '--threads', String(threads), '--gate'], { ...process.env, SS_TOKEN: token });
      exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
      ready = new Promise((resolve, reject) => {
        const lines = readline.createInterface({ input: child.stdout });
        lines.on('line', line => {
          if (line.startsWith('READY ')) resolve(line.slice(6));
          else if (line.startsWith('STEP ')) stepQueue = stepQueue.then(() => onStep(line.slice(5))).catch(error => log.push({ at: iso(now()), error: String(error?.message ?? error) }));
          else if (line.startsWith('WAIT ')) stepQueue = stepQueue.then(() => { waiting = Number(line.slice(5)); release(); });
        });
        exited.then(status => reject(Error(`operator exited before it was ready: ${JSON.stringify(status)}`)));
      });
      const errors = readline.createInterface({ input: child.stderr });
      errors.on('line', line => { if (log.length < 200) log.push({ at: iso(now()), operator: line.slice(0, 300) }); });
      return { listening: await ready, pid: child.pid };
    },
    accept: async ({ terms, partitionIndex }) => {
      const acceptance = await acceptSettlementTerms({ signer, terms, partitionIndex, now });
      records.push(acceptance);
      return acceptance;
    },
    /** The requester's charge binding (its signed zero acknowledgment) opens this share's receipts for the attempt. */
    async charge({ identity: binding, partitionIndex, charge, stage, share }) {
      receipts = await openStageReceipts({ signer, identity: binding, partitionIndex, charge, now, textlessOutputs: true });
      attempt = { attemptId: binding.attemptId, partitionIndex, stage, share };
      release();
      return { reservationId: receipts.reservationId, routeHash: receipts.routeHash };
    },
    async ack({ acknowledged: pair }) {
      const kept = await receipts.acknowledge(pair);
      release();
      return { kept, acknowledged: acknowledged() };
    },
    /** Failure injection for the failure case: the operator process dies mid-answer. */
    async kill() { child?.kill('SIGKILL'); return { killed: Boolean(child) }; },
    /**
     * Failure injection for the stall case: the operator process is stopped (SIGSTOP) mid-answer, so its connection
     * stays open but it never replies. This supervisor stays alive and still signs this share's close.
     */
    async freeze() {
      if (process.platform === 'win32') throw Error('freeze-unsupported: no SIGSTOP on Windows; freeze a Linux or macOS operator');
      if (!child || child.exitCode !== null) throw Error('freeze: no running operator');
      child.kill('SIGSTOP');
      frozen = { at: iso(now()), pid: child.pid };
      return { frozen: true, at: frozen.at };
    },
    /** Close this share: settled, or failed when the operator died or the attempt failed. */
    async close({ failed = false } = {}) {
      closing ??= (async () => {
        const status = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(null), 3000))]);
        await stepQueue;
        const died = Boolean(status && (status.signal || status.code !== 0));
        // A stopped process holds a SIGTERM until it is continued, so a frozen operator is ended with SIGKILL.
        if (child && !status) {
          child.stdin.end();
          child.kill(frozen ? 'SIGKILL' : 'SIGTERM');
          const ended = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(null), 2000))]);
          if (!ended) child.kill('SIGKILL');
        }
        // The supervisor signs this share's close, `failed` when its operator died or the attempt failed. Under the
        // decided rules a `failed` close is not a verified provider failure (it names no cause), so an unfinished
        // answer settles as an unattributed disconnect: the acknowledged prefix. Relief for a real provider failure
        // awaits an owner decision on a provider's signed statement of cause; leaving a close unsigned was rejected.
        const receipt = receipts ? await receipts.close({ failed: failed || died }) : null;
        if (receipt) records.push(receipt);
        return { receipt, operatorExit: status, died, frozen: frozen !== null, closed: Boolean(receipt) };
      })();
      return closing;
    },
    records: async () => ({ records: structuredClone(records), deliveries: structuredClone(deliveries), log: structuredClone(log) }),
    evidence: async () => receipts?.evidence() ?? null
  };
  return { ops, stop: () => { try { child?.kill('SIGKILL'); } catch { /* gone */ } } };
}

async function session() {
  const agent = createShareAgent();
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

async function initIdentity(file) {
  if (await fs.lstat(file).catch(() => null)) throw Error('The identity file exists; enrollment never overwrites it');
  const identity = await createSigningIdentity({ algorithm: 'Ed25519' });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(identity), { mode: 0o600, flag: 'wx' });
  process.stdout.write(JSON.stringify({ participantId: identity.peerId }) + '\n');
}

const args = process.argv.slice(2);
if (args[0] === '--session') await session();
else if (args[0] === '--init-identity' && args[1]) await initIdentity(args[1]);
else if (process.argv[1]?.endsWith('share-agent.js')) { process.stderr.write('usage: share-agent.js --session | --init-identity FILE\n'); process.exitCode = 2; }
