// @vitest-environment node
/**
 * The protected route end to end with real processes: this process is the requester (reploid/inference), Doppler's
 * key holder runs as its child, and each evaluator peer is a separate Node process running Doppler's Go CPU
 * evaluator on the insecure development ring. Skipped unless REPLOID_PROTECTED_BACKEND_DIR names a checkout of
 * Doppler's tools/privacy-protected (branch protected-route) and Go is installed.
 *
 *   REPLOID_PROTECTED_BACKEND_DIR=<doppler>/tools/privacy-protected npx vitest run --config tests/vitest.config.js tests/integration/protected-route.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createInference } from '../../shared/vendor/reploid/inference/index.js';
import { createNodeProtectedExecution } from '../../server/protected-route/requester-host.js';
import { listenFrameSocket, connectFrameSocket } from '../../server/protected-route/frame-socket.js';

const backendDir = process.env.REPLOID_PROTECTED_BACKEND_DIR;
const enabled = !!backendDir && existsSync(path.join(backendDir ?? '', 'go.mod'));
const root = path.resolve(import.meta.dirname, '../..');
const PROFILE = 'dev-insecure-n12';
const execution = { placement: 'network-allowed', participants: { kind: 'open' }, confidentiality: 'requester-only', allowMetadata: ['model-id', 'timing', 'length'] };

describe.skipIf(!enabled)('protected route with the CPU CKKS backend (real processes)', () => {
  let dir, engine, model, modelIdentity, policy, publicSetPolicy, reference, oracleEndpoint, rogueOracleEndpoint, trapFile, unlistedPrompt, unlistedReference;
  const peers = {};
  const children = new Set();

  const startPeer = async (name, misbehave = '') => {
    const ready = path.join(dir, `${name}.ready`);
    const child = spawn(process.execPath, [path.join(root, 'server/protected-route/evaluator-peer.js'), '--engine', engine, '--model', model,
      '--profile', PROFILE, '--identity-file', path.join(dir, `${name}.identity.json`), '--ready-file', ready, '--state-dir', path.join(dir, `${name}-state`),
      ...(misbehave ? ['--misbehave', misbehave] : [])], { stdio: ['ignore', 'ignore', 'pipe'] });
    let log = '';
    child.stderr.on('data', chunk => { log += chunk; });
    children.add(child);
    for (const deadline = Date.now() + 60000; !existsSync(ready); await new Promise(resolve => setTimeout(resolve, 50))) {
      if (child.exitCode !== null || Date.now() > deadline) throw new Error(`peer ${name} did not start: ${log}`);
    }
    const info = JSON.parse(readFileSync(ready, 'utf8'));
    peers[name] = { ...info, child, log: () => log };
    return peers[name];
  };

  const inferenceFor = (endpoints, { stateDir = mkdtempSync(path.join(dir, 'requester-')), flag = true, now, pins = policy, requestTraps } = {}) => {
    const protectedExecution = createNodeProtectedExecution({ endpoints, engine, policy: pins, stateDir, ...(now ? { now } : {}),
      ...(requestTraps ? { requestTraps } : {}) });
    return { protectedExecution, inference: createInference({ resolveRoute() { throw new Error('plaintext route used'); }, execute() { throw new Error('plaintext executor used'); },
      protectedExecution, unreviewedProtectedExecution: flag, ...(now ? { now } : {}) }) };
  };

  const runOnce = async (inference, { content = 'bdf', tokens = 4, requestId = `r${Math.random().toString(16).slice(2)}` } = {}) => {
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

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'protected-route-'));
    engine = path.join(dir, 'privacy-protected');
    execFileSync('go', ['build', '-o', engine, '.'], { cwd: backendDir, stdio: 'inherit' });
    model = path.join(backendDir, 'tiny-model.json');
    modelIdentity = 'sha256:' + createHash('sha256').update(readFileSync(model)).digest('hex');
    trapFile = path.join(dir, 'trapset.json');
    execFileSync(engine, ['trapset', '--model', model, '--key', path.join(dir, 'publisher.key'), '--new-key', '--out', trapFile]);
    const trapSet = JSON.parse(readFileSync(trapFile, 'utf8'));
    const startOracle = async name => {
      const ready = path.join(dir, `${name}.addr`);
      const child = spawn(engine, ['trap-oracle', '--model', model, '--key', path.join(dir, `${name}.key`), '--new-key', '--ready-file', ready, '--exit-with-stdin'],
        { stdio: ['pipe', 'ignore', 'pipe'] });
      children.add(child);
      for (const deadline = Date.now() + 30000; !existsSync(ready); await new Promise(resolve => setTimeout(resolve, 50))) {
        if (Date.now() > deadline) throw new Error('trap oracle did not start');
      }
      const endpoint = `http://${readFileSync(ready, 'utf8')}`;
      const descriptor = await (await fetch(new URL('/v1/descriptor', endpoint))).json();
      return { endpoint, key: descriptor.oracleKey };
    };
    const oracle = await startOracle('oracle'), rogue = await startOracle('rogue');
    oracleEndpoint = oracle.endpoint;
    rogueOracleEndpoint = rogue.endpoint;
    const manifest = JSON.parse(execFileSync(engine, ['evaluator', '--describe', '--profile', PROFILE, '--model', model]));
    // The requester's own pins: the engine protocol, the parameter set (known here to be insecure), the circuit and
    // its layout, the trap set and the publisher key. Nothing below is taken from an advertisement.
    policy = { protocols: ['reploid.protected-generation/v1'], engines: [manifest.protocol],
      parameterSets: [{ id: PROFILE, digest: manifest.profileDigest, insecureDevelopment: true }], allowInsecureDevelopment: true,
      circuits: [{ identity: manifest.circuit, modelIdentity, tokenizer: { alphabet: "abcdefghijklmnopqrstuvwxyz .,!?'" }, vocab: manifest.vocab,
        context: manifest.context, inputLevel: manifest.inputLevel, logSlots: manifest.logSlots, rotations: manifest.rotations,
        traps: { source: 'oracle', endpoint: oracle.endpoint, oracleKeys: [oracle.key] } }],
      trapLanes: 3, maxTrapTolerance: 1, maxKeyEpochSeconds: 86400, allowPublicTrapSet: false };
    // v1, for the comparison only: the same pins with the published trap set.
    publicSetPolicy = { ...policy, allowPublicTrapSet: true,
      circuits: [{ ...policy.circuits[0], traps: { source: 'public-set', envelope: trapSet, publisherKeys: [trapSet.publicKey] } }] };
    const listed = new Set(JSON.parse(trapSet.body).traps.map(trap => trap.prompt.join(',')));
    const letters = "abcdefghijklmnopqrstuvwxyz";
    unlistedPrompt = Array.from({ length: 26 }, (_, a) => letters[a] + letters[(a + 2) % 26] + letters[(a + 4) % 26])
      .find(prompt => !listed.has([...prompt].map(c => letters.indexOf(c)).join(',')));
    unlistedReference = JSON.parse(execFileSync(engine, ['reference', '--model', model, '--prompt', unlistedPrompt, '--generate', '2'])).approximateText;
    reference = JSON.parse(execFileSync(engine, ['reference', '--model', model, '--prompt', 'bdf', '--generate', '4'])).approximateText;
    await Promise.all([startPeer('honest'), startPeer('other'), startPeer('wrong', 'wrong-identity'), startPeer('replay', 'replay-result'),
      startPeer('decrypt', 'ask-decrypt'), startPeer('liar', 'lie-all'), startPeer('random', 'lie-random'), startPeer('drop'),
      startPeer('vanish', `vanish:${trapFile}`)]);
  }, 240000);

  afterAll(() => {
    for (const child of children) child.kill('SIGKILL');
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('generates several tokens that match the pinned reference, with trap and binding evidence, and reuses keys', async () => {
    const stateDir = mkdtempSync(path.join(dir, 'requester-'));
    const { inference, protectedExecution } = inferenceFor([peers.honest.endpoint], { stateDir });
    const { events, result, plan } = await runOnce(inference);
    expect(plan.route.participants).toEqual([peers.honest.participantId]);
    // The development ring is insecure: the disclosures must say no confidentiality and count the evaluator as a reader.
    expect(plan.disclosures.contentReadableBy).toMatchObject({ requesterDevice: true, participants: [peers.honest.participantId] });
    expect(plan.disclosures).toMatchObject({ executorsReadContent: true, confidentiality: { status: 'none' } });
    expect(plan.disclosures.statement).toMatch(/NO confidentiality/);
    expect(plan.disclosures.statement).not.toMatch(/Only this device can read/);
    expect(result.status).toBe('completed');
    expect(result.output.text).toBe(reference);
    expect(events.filter(e => e.type === 'output.delta').map(e => e.text).join('')).toBe(reference);
    const { confidentiality, integrity } = result.executionReceipt.evidence;
    const traps = integrity.verified.find(item => item.claim === 'known-answer-traps').value;
    expect(traps).toMatchObject({ lanes: 4, trapLanes: 3, checks: 12, passed: 12 });
    expect(traps.maxAbsError).toBeLessThan(traps.tolerance);
    expect(integrity.decryptions).toEqual({ trap: 12, real: 4 });
    expect(confidentiality.uploaded.keyFrames).toBe(7);
    const held = protectedExecution.journal.entries().find(entry => entry.state === 'key-holder-closed');
    expect(held.keyHolder).toEqual({ encryptions: 4 * 3 + 3 * 4, decryptions: 16 });
    // Same key epoch: the evaluator still holds the keys, so nothing is uploaded but ciphertexts.
    const again = await runOnce(inference);
    expect(again.result.output.text).toBe(reference);
    expect(again.result.executionReceipt.evidence.confidentiality.uploaded.keyFrames).toBe(0);
    expect(JSON.stringify(protectedExecution.journal.entries())).not.toContain(reference);
  }, 180000);

  it('an evaluator signing as another identity is not bound and receives no keys or ciphertext', async () => {
    const { result } = await runOnce(inferenceFor([peers.wrong.endpoint]).inference);
    expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'EXECUTION_PLAN_CHANGED' } });
    expect(result.executionReceipt.evidence.confidentiality.uploaded).toEqual({ keyFrames: 0, stepFrames: 0, bytes: 0 });
    expect(result.executionReceipt.evidence.integrity.decryptions).toEqual({ trap: 0, real: 0 });
  }, 120000);

  it('refuses a replayed result frame', async () => {
    const { result } = await runOnce(inferenceFor([peers.replay.endpoint]).inference);
    expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'RESULT_UNVERIFIED' } });
    expect(result.error.message).toMatch(/sequence/);
    expect(result.executionReceipt.evidence.integrity.decryptions).toEqual({ trap: 3, real: 1 });
  }, 120000);

  it('refuses a result tampered in transit before decrypting it', async () => {
    const proxy = await startProxy(peers.honest.endpoint, async (frame, direction) => {
      if (direction === 'down' && frame.header.kind === 'result' && frame.header.fields.step === 2) frame.blobs[0][100] ^= 1;
      return frame;
    });
    try {
      const { result } = await runOnce(inferenceFor([proxy.endpoint]).inference);
      expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'RESULT_UNVERIFIED' } });
      expect(result.error.message).toMatch(/signed digest/);
      expect(result.executionReceipt.evidence.integrity.decryptions).toEqual({ trap: 3, real: 1 });
    } finally { await proxy.close(); }
  }, 120000);

  it('an evaluator returning valid ciphertexts of wrong answers fails a trap; nothing real is decrypted', async () => {
    const { result } = await runOnce(inferenceFor([peers.liar.endpoint]).inference);
    expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'RESULT_UNVERIFIED' } });
    expect(result.error.message).toMatch(/trap failed at step 1/);
    expect(result.executionReceipt.evidence.integrity.decryptions.real).toBe(0);
  }, 120000);

  it('records the detection rate of an evaluator that lies on one lane it cannot identify', async () => {
    const trials = Number(process.env.REPLOID_PROTECTED_TRIALS || 16);
    const { inference } = inferenceFor([peers.random.endpoint]);
    const firstToken = JSON.parse(execFileSync(engine, ['reference', '--model', model, '--prompt', 'bdf', '--generate', '1'])).approximateText;
    let detected = 0, undetectedWrong = 0;
    for (let i = 0; i < trials; i++) {
      const { result } = await runOnce(inference, { tokens: 1, requestId: `trial-${i}` });
      if (result.status === 'failed') { expect(result.error.code).toBe('RESULT_UNVERIFIED'); detected++; }
      else { expect(result.output.text).not.toBe(firstToken); undetectedWrong++; }
    }
    const rate = detected / trials;
    console.info(JSON.stringify({ protectedRouteDetection: { trials, detected, undetectedWrong, rate, expected: 0.75 } }));
    // Binomial(16, 0.75): P(X <= 6) < 0.01. Every undetected session returned the tampered (wrong) token.
    expect(detected).toBeGreaterThan(Math.floor(trials * 0.4));
    expect(detected + undetectedWrong).toBe(trials);
  }, 600000);

  it('refuses an evaluator decrypt request with zero decryptions', async () => {
    const { protectedExecution, inference } = inferenceFor([peers.decrypt.endpoint]);
    const { result } = await runOnce(inference);
    expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'RESULT_UNVERIFIED' } });
    expect(result.error.message).toMatch(/decrypt-request/);
    expect(protectedExecution.journal.entries().find(entry => entry.state === 'key-holder-closed').keyHolder.decryptions).toBe(0);
  }, 120000);

  it('a dropped peer yields failed with no partial result', async () => {
    const { inference } = inferenceFor([peers.drop.endpoint]);
    const plan = await inference.prepare({ model: { id: 'doppler-protected-tiny', identity: modelIdentity }, generation: { maxOutputTokens: 4 }, execution });
    const handle = await inference.run({ planId: plan.id, requestId: 'drop', input: { messages: [{ role: 'user', content: 'bdf' }] } });
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
    await expect(timed.run({ planId: plan.id, requestId: 'late', input: { messages: [{ role: 'user', content: 'bdf' }] } }))
      .rejects.toMatchObject({ code: 'EXECUTION_PLAN_EXPIRED' });

    const proxy = await startProxy(peers.honest.endpoint);
    try {
      const endpoints = [proxy.endpoint];
      const { inference } = inferenceFor(endpoints);
      const changed = await inference.prepare({ model: { id: 'doppler-protected-tiny', identity: modelIdentity }, generation: { maxOutputTokens: 2 }, execution });
      endpoints[0] = peers.other.endpoint; // a different evaluator answers at run time
      const before = proxy.state.connections;
      await expect(inference.run({ planId: changed.id, requestId: 'changed', input: { messages: [{ role: 'user', content: 'bdf' }] } }))
        .rejects.toMatchObject({ code: 'EXECUTION_PLAN_CHANGED' });
      expect(proxy.state.connections).toBe(before);
    } finally { await proxy.close(); }
  }, 120000);

  it('the vanishing perturbation: undetected with the public trap set (v1), caught with fresh oracle traps (v2)', async () => {
    const v1 = await runOnce(inferenceFor([peers.vanish.endpoint], { pins: publicSetPolicy }).inference, { content: unlistedPrompt, tokens: 2 });
    expect(v1.result.status).toBe('completed');                 // every published trap came back exact
    expect(v1.result.output.text).not.toBe(unlistedReference);   // and the real answer is the attacker's
    expect(v1.result.executionReceipt.evidence.integrity.verified.find(item => item.claim === 'known-answer-traps').value.passed).toBe(6);
    const v2 = await runOnce(inferenceFor([peers.vanish.endpoint]).inference, { content: unlistedPrompt, tokens: 2 });
    expect(v2.result).toMatchObject({ status: 'failed', output: null, error: { code: 'RESULT_UNVERIFIED' } });
    expect(v2.result.error.message).toMatch(/trap failed at step 1/);
    expect(v2.result.executionReceipt.evidence.integrity.decryptions.real).toBe(0);
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

  it('with the flag off, requester-only is refused and no evaluator is contacted', async () => {
    const proxy = await startProxy(peers.honest.endpoint);
    try {
      const { inference } = inferenceFor([proxy.endpoint], { flag: false });
      await expect(inference.prepare({ model: { id: 'doppler-protected-tiny', identity: modelIdentity }, generation: { maxOutputTokens: 2 }, execution }))
        .rejects.toMatchObject({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE', reason: 'awaiting independent security review' });
      expect(proxy.state.connections).toBe(0);
    } finally { await proxy.close(); }
  }, 60000);
});
