#!/usr/bin/env node
/**
 * A protected evaluator peer: a Reploid signing identity, a signed backend advertisement, and
 * `reploid.protected-generation/v1` sessions over TCP, computed by an engine port the caller supplies
 * (`describe(profile)`, `open(schedule)`, `stop()`). RESEARCH ONLY: requesters refuse this route unless their host
 * enabled the unreviewed protected route.
 *
 * The engine used to be Doppler's Go CPU evaluator as a child process. Reploid runs JavaScript only, so that engine
 * is removed and the command line refuses until a JavaScript engine exists.
 *
 * Logs carry sizes, timings and digests only: the evaluator never has plaintext to log.
 * `misbehave` is for tests and negative runs; engine misbehaviours (lie-all, lie-random, tamper, lie-lane=N) belong to the engine; `vanish:<published trap set>` is the
 * vanishing-perturbation attack on public traps.
 */
import { fileURLToPath } from 'node:url';
import { createSigningIdentity } from '../../shared/vendor/reploid/artifacts/identity.js';
import { createProtectedAdvertisement, serveProtectedEvaluatorSession, createProtectedJournal } from '../../shared/vendor/reploid/mesh/protected-generation.js';
import { listenFrameSocket } from './frame-socket.js';

const ENGINE_MISBEHAVIOUR = ['lie-all', 'lie-random', 'tamper'];
const SESSION_MISBEHAVIOUR = ['ask-decrypt', 'replay-result', 'wrong-identity'];

export async function startProtectedEvaluatorPeer({ engine, profile, identity, listen = '127.0.0.1:0', misbehave = '', maxLanes = 8,
  keyEpochMaxTtlSeconds = 86400, log = () => {} }) {
  if (typeof engine?.describe !== 'function' || typeof engine?.open !== 'function' || typeof engine?.stop !== 'function') {
    throw Object.assign(new Error('No protected evaluator engine: the Go engine was removed (Reploid runs JavaScript only); pass a JavaScript engine port'),
      { code: 'PROTECTED_ENGINE_UNAVAILABLE' });
  }
  if (misbehave && !ENGINE_MISBEHAVIOUR.includes(misbehave) && !SESSION_MISBEHAVIOUR.includes(misbehave) && !/^lie-lane=\d$/.test(misbehave)
    && !/^vanish:\S+$/.test(misbehave)) {
    throw new Error(`Unknown misbehaviour ${misbehave}`);
  }
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
  console.error('evaluator-peer.js: refused. Its engine was Doppler\'s Go privacy-protected evaluator, removed because Reploid runs '
    + 'JavaScript only. Import startProtectedEvaluatorPeer with a JavaScript engine port once one exists.');
  process.exit(2);
}
