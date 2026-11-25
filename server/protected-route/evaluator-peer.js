#!/usr/bin/env node
/**
 * A protected evaluator peer: a Reploid signing identity, a signed backend advertisement, and
 * `reploid.protected-generation/v1` sessions over TCP, computed by a local engine (Doppler's Go CPU evaluator).
 * RESEARCH ONLY: requesters refuse this route unless their host enabled the unreviewed protected route.
 *
 *   node server/protected-route/evaluator-peer.js --engine <privacy-protected binary> --model <tiny-model.json>
 *     --profile research-n16 --identity-file <path> [--listen 127.0.0.1:0] [--ready-file <path>] [--state-dir <dir>]
 *
 * Logs carry sizes, timings and digests only: the evaluator never has plaintext to log.
 * `--misbehave` is for tests and the negative runs of the two-machine script.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createSigningIdentity } from '../../shared/vendor/reploid/artifacts/identity.js';
import { createProtectedAdvertisement, serveProtectedEvaluatorSession, createProtectedJournal } from '../../shared/vendor/reploid/mesh/protected-generation.js';
import { listenFrameSocket } from './frame-socket.js';
import { startGoEvaluator } from './go-evaluator.js';

const ENGINE_MISBEHAVIOUR = ['lie-all', 'lie-random', 'tamper'];
const SESSION_MISBEHAVIOUR = ['ask-decrypt', 'replay-result', 'wrong-identity'];

async function loadIdentity(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
    await writeFile(file, JSON.stringify(identity), { mode: 0o600 });
    return identity;
  }
}

export async function startProtectedEvaluatorPeer({ engine: binary, model, profile, identity, listen = '127.0.0.1:0', stateDir = null,
  misbehave = '', maxLanes = 8, keyEpochMaxTtlSeconds = 86400, log = () => {} }) {
  if (misbehave && !ENGINE_MISBEHAVIOUR.includes(misbehave) && !SESSION_MISBEHAVIOUR.includes(misbehave) && !/^lie-lane=\d$/.test(misbehave)) {
    throw new Error(`Unknown misbehaviour ${misbehave}`);
  }
  const engineMisbehave = SESSION_MISBEHAVIOUR.includes(misbehave) ? '' : misbehave;
  const engine = await startGoEvaluator({ binary, model, stateDir, misbehave: engineMisbehave, maxLanes, log: line => log({ engine: line }) });
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({ options: {
    engine: { type: 'string' }, model: { type: 'string' }, profile: { type: 'string', default: 'research-n16' },
    'identity-file': { type: 'string' }, listen: { type: 'string', default: '127.0.0.1:0' }, 'ready-file': { type: 'string' },
    'state-dir': { type: 'string' }, misbehave: { type: 'string', default: '' }, 'max-lanes': { type: 'string', default: '8' }
  } });
  if (!values.engine || !values.model || !values['identity-file']) {
    console.error('usage: evaluator-peer.js --engine <binary> --model <tiny-model.json> --identity-file <path> [--profile id] [--listen host:port]');
    process.exit(2);
  }
  const log = record => process.stderr.write(JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
  const peer = await startProtectedEvaluatorPeer({ engine: values.engine, model: values.model, profile: values.profile,
    identity: await loadIdentity(values['identity-file']), listen: values.listen, stateDir: values['state-dir'] ?? null,
    misbehave: values.misbehave, maxLanes: Number(values['max-lanes']), log });
  log({ listening: peer.endpoint, participant: peer.participantId, descriptor: peer.advertisement.descriptor.parameterSet });
  if (values['ready-file']) await writeFile(values['ready-file'], JSON.stringify({ endpoint: peer.endpoint, participantId: peer.participantId }), { mode: 0o600 });
  const stop = () => peer.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
