// @vitest-environment node
/**
 * The protected route end to end with real processes: this process is the requester (reploid/inference), Doppler's
 * JavaScript key holder (`pp.js bridge`) runs as its child, and the evaluator peers compute with Doppler's JavaScript
 * WebGPU evaluator (whole, and the homomorphic split into stage A and stage B) on the insecure development ring.
 * Skipped unless REPLOID_PROTECTED_DOPPLER_DIR names a Doppler checkout with tools/privacy-protected (branch
 * protected-route-js). REPLOID_PROTECTED_BACKEND=cpu uses Doppler's JavaScript RNS executor instead of WebGPU (slow).
 *
 *   REPLOID_PROTECTED_DOPPLER_DIR=<doppler> npx vitest run --config tests/vitest.config.js tests/integration/protected-route.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createInference } from '../../shared/vendor/reploid/inference/index.js';
import { createSigningIdentity } from '../../shared/vendor/reploid/artifacts/identity.js';
import { createNodeProtectedExecution } from '../../server/protected-route/requester-host.js';
import { listenFrameSocket, connectFrameSocket } from '../../server/protected-route/frame-socket.js';
import { startProtectedEvaluatorPeer, startLocalDopplerEvaluators } from '../../server/protected-route/evaluator-peer.js';
import { createDopplerEvaluatorEngine } from '../../server/protected-route/doppler-evaluator.js';
import { compileDopplerProgram, describeDopplerEngine, dopplerReference, resolveDopplerProtected } from '../../server/protected-route/doppler-tooling.js';

const doppler = process.env.REPLOID_PROTECTED_DOPPLER_DIR;
const enabled = !!doppler && existsSync(path.join(doppler, 'tools/privacy-protected/pp.js'));
const backend = process.env.REPLOID_PROTECTED_BACKEND || 'webgpu';
const root = path.resolve(import.meta.dirname, '../..');
const PROFILE = 'dev-insecure-n12-u32';
const PROMPT = 'bdf';
/** The Ed25519 public key of a seed file this test wrote: pinned out of band, never read from what it authenticates. */
const publicKeyOfSeed = file => {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.from(readFileSync(file, 'utf8').trim(), 'hex')]);
  return createPublicKey(createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })).export({ format: 'jwk' }).x;
};
const execution = { protection: 'homomorphic', route: 'remote', participants: { kind: 'open' }, allowMetadata: ['model-id', 'timing', 'length'] };
const waitFor = async (file, child, what, ms = 120000) => {
  for (const deadline = Date.now() + ms; !existsSync(file) || !readFileSync(file, 'utf8'); await new Promise(resolve => setTimeout(resolve, 50))) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(`${what} did not start`);
  }
  return readFileSync(file, 'utf8');
};

describe.skipIf(!enabled)('protected route with Doppler\'s JavaScript CKKS and WebGPU evaluator (real processes)', () => {
  let dir, tools, program, modelIdentity, policy, publicSetPolicy, reference, rogueOracleEndpoint;
  const peers = {};
  const children = new Set();
  const stops = [];

  /** An in-process evaluator peer on its own identity over a Doppler engine. */
  const startPeer = async (name, { misbehave = '', engine: engineOptions }) => {
    const engine = createDopplerEvaluatorEngine({ doppler, profile: PROFILE, misbehave: ['ask-decrypt', 'replay-result', 'wrong-identity'].includes(misbehave) ? '' : misbehave,
      ...engineOptions });
    const peer = await startProtectedEvaluatorPeer({ engine, profile: PROFILE, identity: await createSigningIdentity({ algorithm: 'ECDSA' }), misbehave });
    stops.push(() => peer.close());
    peers[name] = peer;
    return peer;
  };

  const inferenceFor = (endpoints, { stateDir = mkdtempSync(path.join(dir, 'requester-')), flag = true, now, pins = policy, requestTraps, timeoutMs } = {}) => {
    const protectedExecution = createNodeProtectedExecution({ endpoints, doppler, policy: pins, stateDir, unreviewedProtectedExecution: flag,
      ...(now ? { now } : {}), ...(requestTraps ? { requestTraps } : {}), ...(timeoutMs ? { timeoutMs } : {}) });
    return { protectedExecution, inference: createInference({ resolveRoute() { throw new Error('plaintext route used'); }, execute() { throw new Error('plaintext executor used'); },
      protectedExecution, unreviewedProtectedExecution: flag, ...(now ? { now } : {}) }) };
  };

  const runOnce = async (inference, { content = PROMPT, tokens = 4, requestId = `r${Math.random().toString(16).slice(2)}` } = {}) => {
    const plan = await inference.prepare({ model: { id: 'doppler-protected-tiny', identity: modelIdentity }, generation: { maxOutputTokens: tokens }, execution });
    const handle = await inference.run({ planId: plan.id, requestId, input: { messages: [{ role: 'user', content }] } });
    const events = [];
    for await (const event of handle.events) events.push(event);
    return { plan, events, result: await handle.result };
  };

  /** A TCP position between requester and evaluator that can rewrite frames, and counts connections. */
  const startProxy = async (target, tap = async frame => frame) => {
    const state = { connections: 0, upstreamKinds: {} };
    const server = await listenFrameSocket({ onChannel: async downstream => {
      state.connections++;
      const upstream = await connectFrameSocket(target);
      const pump = async (from, to, direction) => {
        try {
          for (;;) {
            const frame = await tap(await from.receive({ timeoutMs: 120000 }), direction);
            if (direction === 'up') state.upstreamKinds[frame.header.kind] = (state.upstreamKinds[frame.header.kind] ?? 0) + 1;
            if (frame) await to.send(frame);
          }
        } catch { from.close(); to.close(); }
      };
      pump(downstream, upstream, 'up'); pump(upstream, downstream, 'down');
    } });
    return { ...server, state };
  };

  const startOracle = async name => {
    const ready = path.join(dir, `${name}.addr`);
    const child = spawn(process.execPath, [path.join(tools, 'pp.js'), 'trap-oracle', '--key', path.join(dir, `${name}.key`), '--new-key', '--ready-file', ready,
      '--exit-with-stdin'], { stdio: ['pipe', 'ignore', 'pipe'] });
    children.add(child);
    return { endpoint: `http://${await waitFor(ready, child, 'trap oracle', 30000)}`, key: publicKeyOfSeed(path.join(dir, `${name}.key`)) };
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'protected-route-'));
    ({ tools } = resolveDopplerProtected(doppler));
    // One program covers every case below: the prefill of a 3-symbol prompt and decodes for up to 4 generated tokens.
    program = await compileDopplerProgram({ doppler, profile: PROFILE, promptTokens: PROMPT.length, generatedTokens: 4, out: path.join(dir, 'prog') });
    const trapFile = path.join(dir, 'trapset.json');
    await new Promise((resolve, reject) => spawn(process.execPath, [path.join(tools, 'pp.js'), 'trapset', '--key', path.join(dir, 'publisher.key'), '--new-key',
      '--out', trapFile], { stdio: 'ignore' }).once('exit', code => code === 0 ? resolve() : reject(new Error(`trapset exited ${code}`))));
    const trapSet = JSON.parse(readFileSync(trapFile, 'utf8'));
    const [oracle, rogue] = [await startOracle('oracle'), await startOracle('rogue')];
    rogueOracleEndpoint = rogue.endpoint;
    const manifest = await describeDopplerEngine({ doppler, profile: PROFILE });
    modelIdentity = manifest.model;
    // The requester's own pins: the engine protocol, the parameter set (known here to be insecure), the circuit and
    // its layout, and the oracle key. Nothing below is taken from an advertisement.
    policy = { protocols: ['reploid.protected-generation/v1'], engines: [manifest.protocol],
      parameterSets: [{ id: PROFILE, digest: manifest.profileDigest, insecureDevelopment: true }], allowInsecureDevelopment: true,
      circuits: [{ identity: manifest.circuit, modelIdentity, tokenizer: { alphabet: manifest.alphabet }, vocab: manifest.vocab,
        context: manifest.context, inputLevel: manifest.inputLevel, logSlots: manifest.logSlots, rotations: [...manifest.rotations],
        traps: { source: 'oracle', endpoint: oracle.endpoint, oracleKeys: [oracle.key] } }],
      trapLanes: 3, maxTrapTolerance: 1, maxKeyEpochSeconds: 86400, allowPublicTrapSet: false };
    // v1, for the comparison only: the same pins with the published trap set.
    publicSetPolicy = { ...policy, allowPublicTrapSet: true,
      circuits: [{ ...policy.circuits[0], traps: { source: 'public-set', envelope: trapSet, publisherKeys: [publicKeyOfSeed(path.join(dir, 'publisher.key'))] } }] };
    reference = (await dopplerReference({ doppler, prompt: PROMPT, generate: 4 })).approximateText;
    const whole = await startLocalDopplerEvaluators({ doppler, programs: [program], backend });
    const split = await startLocalDopplerEvaluators({ doppler, programs: [program], split: true, backend });
    stops.push(() => whole.stop(), () => split.stop());
    const onWhole = { engine: { evaluator: whole.evaluator } };
    await startPeer('honest', onWhole);
    await startPeer('other', onWhole);
    await startPeer('split', { engine: { stages: split.stages } });
    for (const misbehave of ['wrong-identity', 'replay-result', 'ask-decrypt', 'lie-all', 'lie-random']) await startPeer(misbehave, { misbehave, ...onWhole });
    // A peer in its own process, on the command line, so it can be killed mid-answer.
    const ready = path.join(dir, 'drop.ready');
    const child = spawn(process.execPath, [path.join(root, 'server/protected-route/evaluator-peer.js'), '--doppler', doppler, '--profile', PROFILE,
      '--identity-file', path.join(dir, 'drop.identity.json'), '--evaluator', whole.evaluator, '--ready-file', ready], { stdio: ['ignore', 'ignore', 'pipe'] });
    children.add(child);
    peers.drop = { ...JSON.parse(await waitFor(ready, child, 'drop peer', 60000)), child };
  }, 300000);

  afterAll(async () => {
    for (const child of children) child.kill('SIGKILL');
    for (const stop of stops.reverse()) await Promise.resolve(stop()).catch(() => {});
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('generates several tokens that match the pinned reference, with trap and binding evidence, and reuses keys', async () => {
    const stateDir = mkdtempSync(path.join(dir, 'requester-'));
    const { inference, protectedExecution } = inferenceFor([peers.honest.endpoint], { stateDir });
    const { events, result, plan } = await runOnce(inference);
    expect(plan.route.participants).toEqual([peers.honest.participantId]);
    // The development ring is insecure: the disclosure must say no protection and count the evaluator as a reader.
    expect(plan.disclosure.prompt.readers).toEqual([{ role: 'requester-device' }, { role: 'evaluator', ids: [peers.honest.participantId] }]);
    expect(plan.disclosure).toMatchObject({ review: { state: 'not-reviewed' }, trustAssumptions: expect.arrayContaining(['insecure-development-parameters']),
      extensions: { homomorphic: { status: { protection: 'none' } } } });
    expect(plan).toMatchObject({ routeKind: 'remote', maxCharge: { kind: 'free' } });
    expect(result.status).toBe('completed');
    expect(result.output.text).toBe(reference);
    expect(events.filter(e => e.type === 'output.delta').map(e => e.text).join('')).toBe(reference);
    const { privacy, integrity } = result.executionReceipt.evidence;
    const traps = integrity.checks.find(item => item.claim === 'known-answer-traps').value;
    expect(traps).toMatchObject({ lanes: 4, trapLanes: 3, checks: 12, passed: 12 });
    expect(traps.maxAbsError).toBeLessThan(traps.tolerance);
    expect(integrity.extensions.homomorphic.decryptions).toEqual({ trap: 12, real: 4 });
    expect(privacy.extensions.homomorphic.uploaded.keyFrames).toBe(7);
    const held = protectedExecution.journal.entries().find(entry => entry.state === 'key-holder-closed');
    expect(held.keyHolder).toEqual({ encryptions: 4 * 3 + 3 * 4, decryptions: 16 });
    // Same key epoch: the evaluator still holds the keys, so nothing is uploaded but ciphertexts.
    const again = await runOnce(inference);
    expect(again.result.output.text).toBe(reference);
    expect(again.result.executionReceipt.evidence.privacy.extensions.homomorphic.uploaded.keyFrames).toBe(0);
    expect(JSON.stringify(protectedExecution.journal.entries())).not.toContain(reference);
  }, 180000);

  it('the homomorphic split: stage A and stage B return the same tokens, with every trap checked', async () => {
    const { result, plan } = await runOnce(inferenceFor([peers.split.endpoint]).inference);
    expect(plan.route.participants).toEqual([peers.split.participantId]);
    expect(result.status).toBe('completed');
    expect(result.output.text).toBe(reference);
    expect(result.executionReceipt.evidence.integrity.checks.find(item => item.claim === 'known-answer-traps').value).toMatchObject({ checks: 12, passed: 12 });
  }, 180000);

  it('an evaluator signing as another identity is not bound and receives no keys or ciphertext', async () => {
    const { result } = await runOnce(inferenceFor([peers['wrong-identity'].endpoint]).inference);
    expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'EXECUTION_PLAN_CHANGED' } });
    expect(result.executionReceipt.evidence.privacy.extensions.homomorphic.uploaded).toEqual({ keyFrames: 0, stepFrames: 0, bytes: 0 });
    expect(result.executionReceipt.evidence.integrity.extensions.homomorphic.decryptions).toEqual({ trap: 0, real: 0 });
  }, 120000);

  it('ignores a replayed result frame and does not blame the evaluator', async () => {
    const { inference } = inferenceFor([peers['replay-result'].endpoint], { timeoutMs: 20000 });
    const { result } = await runOnce(inference);
    expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'PROTECTED_SESSION_CLOSED' } });
    expect(result.executionReceipt.evidence.integrity.extensions.homomorphic.decryptions).toEqual({ trap: 3, real: 1 });
    await expect(inference.prepare({ model: { id: 'doppler-protected-tiny', identity: modelIdentity }, generation: { maxOutputTokens: 1 }, execution })).resolves.toBeTruthy();
  }, 120000);

  it('closes on a result altered in transit, before decrypting it, without blaming the evaluator', async () => {
    const proxy = await startProxy(peers.honest.endpoint, async (frame, direction) => {
      if (direction === 'down' && frame.header.kind === 'result' && frame.header.fields.step === 2) frame.blobs[0][100] ^= 1;
      return frame;
    });
    try {
      const { result } = await runOnce(inferenceFor([proxy.endpoint]).inference);
      expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'PROTECTED_SESSION_CLOSED' } });
      expect(result.error.message).toMatch(/signed digest/);
      expect(result.executionReceipt.evidence.integrity.extensions.homomorphic.decryptions).toEqual({ trap: 3, real: 1 });
    } finally { await proxy.close(); }
  }, 120000);

  it('a trap failure is silent to the evaluator; then the epoch is retired and the evaluator locked out', async () => {
    const proxy = await startProxy(peers['lie-all'].endpoint);
    try {
      const stateDir = mkdtempSync(path.join(dir, 'requester-'));
      const { inference } = inferenceFor([proxy.endpoint], { stateDir });
      const { result, events } = await runOnce(inference);
      expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'RESULT_UNVERIFIED' } });
      expect(result.error.message).toMatch(/trap failed at step 1/);
      expect(result.executionReceipt.evidence.integrity.extensions.homomorphic.decryptions).toEqual({ trap: 3, real: 0 });
      expect(events.filter(event => event.type === 'output.delta')).toHaveLength(0);
      // The evaluator was fed the whole fixed schedule and a normal close.
      expect(proxy.state.upstreamKinds).toMatchObject({ step: 4, bye: 1 });
      expect(existsSync(path.join(stateDir, 'key-epoch.sk'))).toBe(false);
      await expect(inference.prepare({ model: { id: 'doppler-protected-tiny', identity: modelIdentity }, generation: { maxOutputTokens: 1 }, execution }))
        .rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
    } finally { await proxy.close(); }
  }, 120000);

  it('records the detection rate of an evaluator that lies on one lane it cannot identify', async () => {
    const trials = Number(process.env.REPLOID_PROTECTED_TRIALS || 16);
    let detected = 0, undetected = 0;
    for (let i = 0; i < trials; i++) {
      // A fresh requester per trial: after a failure a requester locks the evaluator out.
      const { result } = await runOnce(inferenceFor([peers['lie-random'].endpoint]).inference, { tokens: 1, requestId: `trial-${i}` });
      if (result.status === 'failed') { expect(result.error.code).toBe('RESULT_UNVERIFIED'); detected++; } else undetected++;
    }
    const rate = detected / trials;
    console.info(JSON.stringify({ protectedRouteDetection: { trials, detected, undetected, rate, expected: 0.75 } }));
    // Binomial(16, 0.75): P(X <= 6) < 0.01. An undetected session took the real lane's flipped ciphertext.
    expect(detected).toBeGreaterThan(Math.floor(trials * 0.4));
    expect(detected + undetected).toBe(trials);
  }, 600000);

  it('refuses an evaluator decrypt request with zero decryptions', async () => {
    const { protectedExecution, inference } = inferenceFor([peers['ask-decrypt'].endpoint]);
    const { result } = await runOnce(inference);
    expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'RESULT_UNVERIFIED' } });
    expect(result.error.message).toMatch(/decrypt-request/);
    expect(protectedExecution.journal.entries().find(entry => entry.state === 'key-holder-closed').keyHolder.decryptions).toBe(0);
  }, 120000);

  it('a dropped peer yields failed with no partial result', async () => {
    const { inference } = inferenceFor([peers.drop.endpoint]);
    const plan = await inference.prepare({ model: { id: 'doppler-protected-tiny', identity: modelIdentity }, generation: { maxOutputTokens: 4 }, execution });
    const handle = await inference.run({ planId: plan.id, requestId: 'drop', input: { messages: [{ role: 'user', content: PROMPT }] } });
    const events = [];
    for await (const event of handle.events) {
      events.push(event);
      if (event.type === 'output.delta') peers.drop.child.kill('SIGKILL');
    }
    const result = await handle.result;
    expect(result).toMatchObject({ status: 'failed', output: null, usage: null, error: { code: 'PROTECTED_SESSION_CLOSED' } });
    expect(events.at(-1).type).toBe('failed');
    expect(events.filter(e => e.type === 'output.delta')).toHaveLength(1);
  }, 120000);

  it('an expired plan or a changed evaluator sends nothing', async () => {
    let time = Date.now();
    const timed = inferenceFor([peers.honest.endpoint], { now: () => time }).inference;
    const plan = await timed.prepare({ model: { id: 'doppler-protected-tiny', identity: modelIdentity }, generation: { maxOutputTokens: 2 }, execution });
    time += 10 * 60 * 1000;
    await expect(timed.run({ planId: plan.id, requestId: 'late', input: { messages: [{ role: 'user', content: PROMPT }] } }))
      .rejects.toMatchObject({ code: 'EXECUTION_PLAN_EXPIRED' });

    const proxy = await startProxy(peers.honest.endpoint);
    try {
      const endpoints = [proxy.endpoint];
      const { inference } = inferenceFor(endpoints);
      const changed = await inference.prepare({ model: { id: 'doppler-protected-tiny', identity: modelIdentity }, generation: { maxOutputTokens: 2 }, execution });
      endpoints[0] = peers.other.endpoint; // a different evaluator answers at run time
      const before = proxy.state.connections;
      await expect(inference.run({ planId: changed.id, requestId: 'changed', input: { messages: [{ role: 'user', content: PROMPT }] } }))
        .rejects.toMatchObject({ code: 'EXECUTION_PLAN_CHANGED' });
      expect(proxy.state.connections).toBe(before);
    } finally { await proxy.close(); }
  }, 120000);

  it('a public trap set (v1) is refused unless allowed, and as a comparison it verifies the published traps only', async () => {
    await expect(inferenceFor([peers.honest.endpoint], { pins: { ...publicSetPolicy, allowPublicTrapSet: false } }).inference
      .prepare({ model: { id: 'doppler-protected-tiny', identity: modelIdentity }, generation: { maxOutputTokens: 2 }, execution }))
      .rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
    const v1 = await runOnce(inferenceFor([peers.honest.endpoint], { pins: publicSetPolicy }).inference, { tokens: 2 });
    expect(v1.result.status).toBe('completed');
    expect(v1.result.executionReceipt.evidence.integrity.checks.find(item => item.claim === 'known-answer-traps'))
      .toMatchObject({ method: expect.stringMatching(/broken: vanishing perturbation/), value: { source: 'public-set', passed: 6 } });
  }, 180000);

  it('refuses traps from an oracle whose key is not pinned, before contacting the evaluator', async () => {
    const proxy = await startProxy(peers.honest.endpoint);
    try {
      const pins = { ...policy, circuits: [{ ...policy.circuits[0], traps: { ...policy.circuits[0].traps, endpoint: rogueOracleEndpoint } }] };
      const { result } = await runOnce(inferenceFor([proxy.endpoint], { pins }).inference);
      expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'EXECUTION_ROUTE_UNAVAILABLE' } });
      expect(result.error.message).toMatch(/oracle key is not pinned/);
      // Advertisement requests (prepare, and run's recheck) only: no bind offer, key or ciphertext reached the evaluator.
      expect(Object.keys(proxy.state.upstreamKinds)).toEqual(['advertise-request']);
    } finally { await proxy.close(); }
  }, 120000);

  it('refuses a stale trap batch replayed into a later session', async () => {
    let stale = null;
    const requestTraps = async ({ endpoint, request }) => {
      if (stale) return stale;
      const response = await fetch(new URL('/v1/trap-batch', endpoint), { method: 'POST', body: JSON.stringify(request) });
      return (stale = await response.json());
    };
    const { inference } = inferenceFor([peers.honest.endpoint], { requestTraps });
    expect((await runOnce(inference, { tokens: 1 })).result.status).toBe('completed');
    const { result } = await runOnce(inference, { tokens: 1 });
    expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'EXECUTION_ROUTE_UNAVAILABLE' } });
    expect(result.error.message).toMatch(/stale or replayed/);
  }, 120000);

  it('with the flag off, homomorphic is refused and no evaluator is contacted', async () => {
    const proxy = await startProxy(peers.honest.endpoint);
    try {
      const { inference } = inferenceFor([proxy.endpoint], { flag: false });
      await expect(inference.prepare({ model: { id: 'doppler-protected-tiny', identity: modelIdentity }, generation: { maxOutputTokens: 2 }, execution }))
        .rejects.toMatchObject({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE', reason: 'awaiting independent security review' });
      expect(proxy.state.connections).toBe(0);
    } finally { await proxy.close(); }
  }, 60000);
});
