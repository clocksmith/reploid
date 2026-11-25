#!/usr/bin/env node
/**
 * A protected evaluator peer: a Reploid signing identity, a signed backend advertisement, and
 * `reploid.protected-generation/v1` sessions over TCP, computed by an engine port (`describe(profile)`,
 * `open(schedule)`, `stop()`). RESEARCH ONLY: requesters refuse this route unless their host enabled the unreviewed
 * protected route.
 *
 * The engine is Doppler's JavaScript WebGPU evaluator (doppler-evaluator.js): one whole-model evaluator, or the
 * homomorphic split across a stage A and a stage B evaluator, possibly on other machines.
 *
 *   node server/protected-route/evaluator-peer.js --doppler <doppler checkout> --profile research-n16-u32 --identity-file id.json
 *        (--evaluator host:port | --stage-a host:port --stage-b host:port | --program <base> [--program ...] [--split] [--backend webgpu|cpu])
 *        [--listen 127.0.0.1:0] [--ready-file f] [--state-dir d] [--misbehave m] [--max-lanes 8]
 *
 * With --program it starts the Doppler evaluator processes itself (whole, or both stages with --split) on this
 * machine. Logs carry sizes, timings and digests only: the evaluator never has plaintext to log.
 * `misbehave` is for tests and negative runs: engine misbehaviours (lie-all, lie-random, tamper, lie-lane=N) flip bits
 * of result ciphertexts; session misbehaviours (ask-decrypt, replay-result, wrong-identity) break the protocol. The
 * vanishing-perturbation attack on public trap sets is a homomorphic computation Doppler's JavaScript evaluator does
 * not implement; its trap semantics are covered by the unit tests with a fake engine.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createSigningIdentity } from '../../shared/vendor/reploid/artifacts/identity.js';
import { createProtectedAdvertisement, serveProtectedEvaluatorSession, createProtectedJournal } from '../../shared/vendor/reploid/mesh/protected-generation.js';
import { listenFrameSocket } from './frame-socket.js';
import { createDopplerEvaluatorEngine, startDopplerEvaluator, DOPPLER_ENGINE_MISBEHAVIOUR } from './doppler-evaluator.js';

const SESSION_MISBEHAVIOUR = ['ask-decrypt', 'replay-result', 'wrong-identity'];
const engineMisbehaviour = misbehave => DOPPLER_ENGINE_MISBEHAVIOUR.includes(misbehave) || /^lie-lane=\d$/.test(misbehave);

export async function loadIdentity(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
    await writeFile(file, JSON.stringify(identity), { mode: 0o600 });
    return identity;
  }
}

export async function startProtectedEvaluatorPeer({ engine, profile, identity, listen = '127.0.0.1:0', misbehave = '', maxLanes = 8,
  keyEpochMaxTtlSeconds = 86400, log = () => {} }) {
  if (typeof engine?.describe !== 'function' || typeof engine?.open !== 'function' || typeof engine?.stop !== 'function') {
    throw Object.assign(new Error('No protected evaluator engine: pass an engine port (createDopplerEvaluatorEngine over Doppler\'s JavaScript evaluator)'),
      { code: 'PROTECTED_ENGINE_UNAVAILABLE' });
  }
  if (/^vanish:/.test(misbehave)) {
    throw Object.assign(new Error('The vanishing perturbation needs a homomorphic evaluator change Doppler\'s JavaScript evaluator does not implement'),
      { code: 'PROTECTED_ENGINE_UNAVAILABLE' });
  }
  if (misbehave && !engineMisbehaviour(misbehave) && !SESSION_MISBEHAVIOUR.includes(misbehave)) throw new Error(`Unknown misbehaviour ${misbehave}`);
  const manifest = await engine.describe(profile);
  const advertisement = await createProtectedAdvertisement({ identity, manifest, keyEpochMaxTtlSeconds, maxLanes });
  const signingIdentity = misbehave === 'wrong-identity' ? await createSigningIdentity({ algorithm: 'ECDSA' }) : identity;
  const seenNonces = new Map();
  const journal = createProtectedJournal({ limit: 4096 });
  const sessions = new Set();
  const [host, port] = [listen.replace(/:\d+$/, ''), Number(listen.match(/:(\d+)$/)?.[1] ?? 0)];
  const server = await listenFrameSocket({ host, port, onChannel: channel => {
    const session = serveProtectedEvaluatorSession({ channel, identity, advertisement, backend: engine, seenNonces, journal,
      misbehave: SESSION_MISBEHAVIOUR.includes(misbehave) && misbehave !== 'wrong-identity' ? misbehave : null, signingIdentity })
      .then(outcome => { if (outcome.outcome !== 'advertised') log({ session: outcome.outcome, error: outcome.error ?? null, frames: outcome.frames, bytes: outcome.bytes }); });
    sessions.add(session);
    session.finally(() => sessions.delete(session));
  } });
  return Object.freeze({
    endpoint: server.endpoint, participantId: identity.peerId, advertisement, journal,
    async close() { await server.close(); await Promise.allSettled([...sessions]); engine.stop(); }
  });
}

/** Start the Doppler evaluators a peer computes with: whole, or stage B then stage A pointed at it. */
export async function startLocalDopplerEvaluators({ doppler, programs, split = false, backend = 'webgpu', stateDir = null, maxLanes = 8, log = () => {} }) {
  if (!split) {
    const whole = await startDopplerEvaluator({ doppler, programs, backend, stateDir, maxLanes, log });
    return { evaluator: whole.address, stop: () => whole.stop() };
  }
  const b = await startDopplerEvaluator({ doppler, programs, role: 'stage-b', backend, maxLanes, log });
  const a = await startDopplerEvaluator({ doppler, programs, role: 'stage-a', next: b.hop, backend, maxLanes, log });
  return { stages: { a: a.address, b: b.address }, stop: () => { a.stop(); b.stop(); } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({ options: {
    doppler: { type: 'string' }, profile: { type: 'string', default: 'research-n16-u32' }, model: { type: 'string' },
    evaluator: { type: 'string' }, 'stage-a': { type: 'string' }, 'stage-b': { type: 'string' },
    program: { type: 'string', multiple: true }, split: { type: 'boolean', default: false }, backend: { type: 'string', default: 'webgpu' },
    'identity-file': { type: 'string' }, listen: { type: 'string', default: '127.0.0.1:0' }, 'ready-file': { type: 'string' },
    'state-dir': { type: 'string' }, misbehave: { type: 'string', default: '' }, 'max-lanes': { type: 'string', default: '8' }
  } });
  const addressed = values.evaluator || values['stage-a'] || values['stage-b'];
  if (!values.doppler || !values['identity-file'] || (!addressed === !values.program?.length)) {
    console.error('usage: evaluator-peer.js --doppler <checkout> --identity-file <path> (--evaluator a | --stage-a a --stage-b b | --program base [--split]) '
      + '[--profile id] [--listen host:port] (see the header of this file)');
    process.exit(2);
  }
  const log = record => process.stderr.write(JSON.stringify({ at: new Date().toISOString(), ...(typeof record === 'string' ? { engine: record } : record) }) + '\n');
  const maxLanes = Number(values['max-lanes']);
  const local = values.program?.length ? await startLocalDopplerEvaluators({ doppler: values.doppler, programs: values.program, split: values.split,
    backend: values.backend, stateDir: values['state-dir'] ?? null, maxLanes, log }) : null;
  const engine = createDopplerEvaluatorEngine({ doppler: values.doppler, profile: values.profile, model: values.model ?? null, maxLanes,
    misbehave: engineMisbehaviour(values.misbehave) ? values.misbehave : '', onStop: () => local?.stop(),
    ...(local ?? (values.evaluator ? { evaluator: values.evaluator } : { stages: { a: values['stage-a'], b: values['stage-b'] } })) });
  const peer = await startProtectedEvaluatorPeer({ engine, profile: values.profile, identity: await loadIdentity(values['identity-file']),
    listen: values.listen, misbehave: values.misbehave, maxLanes, log });
  log({ listening: peer.endpoint, participant: peer.participantId, descriptor: peer.advertisement.descriptor.parameterSet,
    engine: peer.advertisement.descriptor.engine });
  if (values['ready-file']) await writeFile(values['ready-file'], JSON.stringify({ endpoint: peer.endpoint, participantId: peer.participantId }), { mode: 0o600 });
  const stop = () => peer.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
