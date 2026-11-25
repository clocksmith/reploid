/**
 * The evaluator engine port backed by Doppler's JavaScript WebGPU evaluator (`tools/privacy-protected/webgpu/evaluator.js`),
 * whole or as the homomorphic split: stage A (embedding through attention, holding the encrypted KV cache) and stage B
 * (MLP through the head), cut at Doppler's `ln2` boundary. It computes on ciphertext with public weights and public
 * evaluation keys; no Doppler evaluator has a secret key, and none of this code does.
 *
 *   whole:  createDopplerEvaluatorEngine({ doppler, profile, evaluator: 'host:port' })
 *   split:  createDopplerEvaluatorEngine({ doppler, profile, stages: { a: 'host:port', b: 'host:port' } })
 *
 * In the split every key goes to both stages, each step's inputs to stage A only, and the result comes from stage B
 * only. Stage A sends the carry ciphertexts straight to stage B over its own link, admitted by a one-time hop token
 * this engine gives both stages; this engine never sees the carry.
 *
 * `startDopplerEvaluator` runs one evaluator as a child of this process (development and tests); fleet runs start each
 * stage on its own machine and pass its address.
 */
import { spawn } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { connectFrameSocket, ceilingHeaderInspector } from './frame-socket.js';
import { describeDopplerEngine, resolveDopplerProtected } from './doppler-tooling.js';

const SPLIT_LAYER = 'ln2';
const inspect = ceilingHeaderInspector({ manifest: 0, ready: 0, result: 8 * (32 << 20), 'decrypt-request': 64 << 20 });
/** Engine misbehaviours (tests and negative runs): flip one bit of some lanes' result ciphertexts. */
export const DOPPLER_ENGINE_MISBEHAVIOUR = Object.freeze(['lie-all', 'lie-random', 'tamper']);
const LIE_LANE = /^lie-lane=(\d)$/;

/** Start one Doppler evaluator process (whole, stage-a or stage-b) and wait until it listens. */
export async function startDopplerEvaluator({ doppler, programs, role = 'whole', backend = 'webgpu', next = null, hopListen = '127.0.0.1:0',
  listen = '127.0.0.1:0', stateDir = null, maxLanes = 8, timing = 'overlap', report = null, log = () => {}, startTimeoutMs = 120000 }) {
  const { evaluator } = resolveDopplerProtected(doppler);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'doppler-evaluator-'));
  const ready = path.join(dir, 'ready');
  const args = [evaluator, ...programs.flatMap(base => ['--program', base]), '--listen', listen, '--ready-file', ready, '--sessions', '0',
    '--backend', backend, '--max-lanes', String(maxLanes), '--timing', timing, '--role', role];
  if (role === 'stage-a') args.push('--next', next);
  if (role === 'stage-b') args.push('--hop-listen', hopListen);
  if (stateDir) args.push('--state-dir', stateDir);
  if (report) args.push('--report', report);
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '', hop = null;
  child.stderr.on('data', chunk => {
    const text = String(chunk);
    stderr = (stderr + text).slice(-4096);
    hop ??= /hop link listening on (\S+)/.exec(text)?.[1] ?? null;
    for (const line of text.split('\n')) if (line.trim()) log(line.trim());
  });
  let address = null;
  try {
    for (const deadline = Date.now() + startTimeoutMs; !address; await new Promise(resolve => setTimeout(resolve, 50))) {
      address = (await readFile(ready, 'utf8').catch(() => '')) || null;
      if (child.exitCode !== null) throw new Error(`The Doppler evaluator exited during start: ${stderr.trim()}`);
      if (Date.now() > deadline) { child.kill('SIGKILL'); throw new Error('The Doppler evaluator did not start'); }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
  if (role === 'stage-b') for (let i = 0; !hop && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 20));
  return Object.freeze({ address, hop, role, child, stop: () => child.kill('SIGTERM') });
}

/**
 * The engine port for `startProtectedEvaluatorPeer`: `describe(profile)`, `open(schedule)`, `stop()`. One engine
 * session per protected session, one at a time per engine.
 */
export function createDopplerEvaluatorEngine({ doppler, profile, model = null, evaluator = null, stages = null, maxLanes = 8, misbehave = '',
  timeoutMs = 30 * 60 * 1000, connectTimeoutMs = 30000, onStop = () => {}, random = randomInt }) {
  resolveDopplerProtected(doppler);
  const split = Boolean(stages);
  if (split ? !(stages.a && stages.b) || evaluator : !evaluator) {
    throw new Error('A Doppler engine needs one evaluator address, or stage A and stage B addresses for the split');
  }
  if (misbehave && !DOPPLER_ENGINE_MISBEHAVIOUR.includes(misbehave) && !LIE_LANE.test(misbehave)) throw new Error(`Unknown engine misbehaviour ${misbehave}`);
  const roles = split ? [['stage-a', stages.a], ['stage-b', stages.b]] : [['whole', evaluator]];
  let described = null;
  const describe = async (asked = profile) => {
    if (asked !== profile) throw new Error(`This engine runs ${profile}, not ${asked}`);
    described ??= await describeDopplerEngine({ doppler, profile, model, maxLanes,
      implementation: split ? 'doppler-webgpu-split/ln2' : 'doppler-webgpu-evaluator' });
    return described;
  };
  let lock = Promise.resolve();
  return Object.freeze({
    describe,
    async open({ profile: asked, modelIdentity, lanes, promptTokens, generatedTokens, keyEpoch }) {
      const pinned = await describe(asked);
      if (modelIdentity !== pinned.model) throw new Error('The session pins another model');
      let release;
      const previous = lock;
      lock = new Promise(resolve => { release = resolve; });
      await previous;
      const links = [];
      const session = randomBytes(16).toString('hex');
      const hopToken = split ? randomBytes(16).toString('hex') : null;
      const send = (link, kind, fields = {}, blobs = [], seq = 0) => link.send({ header: { kind, protocol: pinned.protocol, session, seq,
        blobs: blobs.map(blob => blob.length), fields }, blobs });
      const expect = async (link, kind) => {
        const frame = await link.receive({ timeoutMs });
        if (frame.header.kind !== kind) throw new Error(`Engine answered ${frame.header.kind}, expected ${kind}`);
        if (frame.header.session !== session) throw new Error('Engine answered for another session');
        return frame;
      };
      const closeAll = () => { for (const link of links) link.close(); };
      try {
        const manifests = [];
        // Admission before upload: every stage states exactly the pinned profile, model, layout, lanes and role.
        for (const [role, address] of roles) {
          const link = await connectFrameSocket(address, { inspect, timeoutMs: connectTimeoutMs });
          links.push(link);
          await send(link, 'hello', { profile: pinned.profile, model: pinned.model, promptTokens, generatedTokens, keyEpoch: keyEpoch.id,
            keyEpochExpires: keyEpoch.expiresAt, lanes, ...(split ? { role, cutLayer: SPLIT_LAYER, hopToken } : {}) });
          const manifest = (await expect(link, 'manifest')).header.fields;
          if (manifest.profileDigest !== pinned.profileDigest || manifest.model !== pinned.model || manifest.inputLevel !== pinned.inputLevel
            || manifest.logSlots !== pinned.logSlots || JSON.stringify(manifest.rotations) !== JSON.stringify(pinned.rotations)
            || (manifest.lanes ?? 1) !== lanes || (manifest.role ?? 'whole') !== role || (split && manifest.cutLayer !== SPLIT_LAYER)) {
            throw new Error(`The Doppler ${role} evaluator does not match the pinned profile, model, layout, lanes or role`);
          }
          manifests.push(manifest);
        }
        const held = manifests.every(item => item.heldKeysDigest && item.heldKeysDigest === manifests[0].heldKeysDigest) ? manifests[0].heldKeysDigest : '';
        const [first, last] = [links[0], links.at(-1)];
        const lie = misbehave === 'lie-all' ? () => true : misbehave === 'tamper' ? lane => lane === 0
          : LIE_LANE.test(misbehave) ? lane => lane === Number(LIE_LANE.exec(misbehave)[1])
            : misbehave === 'lie-random' ? (chosen => lane => lane === chosen)(random(lanes)) : () => false;
        return {
          manifest: { profileDigest: pinned.profileDigest, circuit: pinned.circuit, rotations: pinned.rotations, heldKeysDigest: held },
          keyCount: 1 + pinned.rotations.length,
          sendKey: async blob => { for (const link of links) await send(link, 'key', {}, [blob]); },
          keysHeld: async () => { for (const link of links) await send(link, 'keys-held'); },
          async ready() {
            const digests = [];
            for (const link of links) digests.push((await expect(link, 'ready')).header.fields.keysDigest);
            if (digests.some(item => item !== digests[0])) throw new Error('The stages acknowledged different evaluation keys');
            return digests[0];
          },
          async step({ phase, seq, blobs }) {
            await send(first, phase, {}, blobs, seq);
            const frame = await expect(last, 'result');
            if (frame.header.seq !== seq || frame.blobs.length !== lanes) throw new Error('Engine result is not for this step');
            return frame.blobs.map((blob, lane) => {
              if (!lie(lane)) return blob;
              const out = new Uint8Array(blob);
              out[out.length >> 1] ^= 1;
              return out;
            });
          },
          async close() {
            for (const link of links) await send(link, 'bye').catch(() => {});
            closeAll();
            release();
          }
        };
      } catch (error) { closeAll(); release(); throw error; }
    },
    stop() { onStop(); }
  });
}
