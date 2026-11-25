// @vitest-environment node
/**
 * reploid.protected-generation/v1 with in-process fakes: a fake key holder whose "ciphertexts" are tagged tokens
 * and a fake engine computing a fixed toy model. These pin the protocol (eligibility, binding, frames, traps,
 * flag, trap oracle v2 and the vanishing perturbation) and the trap detection rate cheaply; tests/integration/protected-route.test.js runs the real CKKS backend.
 */
import { describe, it, expect } from 'vitest';
import { createInference, PROTECTED_EXECUTION_STATUS } from '../../packages/reploid/src/inference/index.js';
import { createProtectedExecution } from '../../packages/reploid/src/inference/protected.js';
import { createSigningIdentity, toBase64Url } from '../../packages/reploid/src/artifacts/identity.js';
import {
  createProtectedAdvertisement, createMemoryFrameChannelPair, serveProtectedEvaluatorSession, createProtectedJournal,
  trapDetectionProbability, totalArgmax, checkTrapResult, planProtectedLanes, createFrameDecoder, encodeProtectedFrame,
  inspectProtectedHeader, requestProtectedAdvertisement
} from '../../packages/reploid/src/mesh/protected-generation.js';
import { fromBase64Url } from '../../packages/reploid/src/artifacts/identity.js';

const VOCAB = 32, CONTEXT = 8, ALPHABET = "abcdefghijklmnopqrstuvwxyz .,!?'";
const MODEL = 'sha256:' + '1'.repeat(64), CIRCUIT = 'sha256:' + '2'.repeat(64), PROFILE = 'sha256:' + '3'.repeat(64);
const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const sha = async bytes => 'sha256:' + hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));

// Toy model: the next token continues the stride of the last two tokens; logits 10 there, small elsewhere.
const toyLogits = tokens => {
  const last = tokens.at(-1), prev = tokens.length > 1 ? tokens.at(-2) : last - 1;
  const next = ((2 * last - prev) % 26 + 26) % 26;
  return Array.from({ length: VOCAB }, (_, i) => i === next ? 10 : (i % 7) / 10);
};
const greedy = (prompt, steps) => {
  const toks = [...prompt], out = [];
  for (let i = 0; i < steps; i++) { const t = totalArgmax(toyLogits(toks)); out.push(t); toks.push(t); }
  return out;
};
const encodeLogits = values => { const b = new Uint8Array(8 * values.length); const v = new DataView(b.buffer); values.forEach((x, i) => v.setFloat64(8 * i, x, true)); return b; };
const decodeLogits = b => { const v = new DataView(b.buffer, b.byteOffset, b.length); return Float64Array.from({ length: b.length / 8 }, (_, i) => v.getFloat64(8 * i, true)); };

async function signedTrapSet() {
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
  const traps = [];
  for (let L = 2; L <= CONTEXT; L++) {
    for (let k = 0; k < 6; k++) {
      const a = (L * 5 + k * 3) % 26, stride = 1 + k % 3;
      const prompt = Array.from({ length: L }, (_, i) => (a + i * stride) % 26);
      const continuation = greedy(prompt, CONTEXT - L + 1).slice(0, CONTEXT - L);
      const all = [...prompt, ...continuation];
      traps.push({ id: `L${L}-${k}`, prompt, continuation,
        expectedLogits: Array.from({ length: CONTEXT - L + 1 }, (_, i) => toyLogits(all.slice(0, L + i))) });
    }
  }
  const body = JSON.stringify({ schema: 'doppler.protected-trapset/v1', protocol: 'toy', model: MODEL, circuit: CIRCUIT,
    tokenizer: { alphabet: ALPHABET }, vocab: VOCAB, context: CONTEXT,
    tolerance: { maxAbsLogitError: 0.75, minReferenceMargin: 2.5, requireArgmax: true }, traps });
  const bytes = new TextEncoder().encode(body);
  const signed = new Uint8Array([...new TextEncoder().encode('doppler.protected-trapset/v1\x00'), ...bytes]);
  return { envelope: { schema: 'doppler.protected-trapset-envelope/v1', body, bodyDigest: await sha(bytes), publicKey,
    signature: toBase64Url(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, signed))) }, publicKey };
}

/**
 * A trap oracle in Doppler's wire format: fresh prompts per request (letter progressions and random letters), the toy
 * model's continuation and expected logits, encrypted to the request's X25519 key and signed with Ed25519.
 */
async function fakeOracle() {
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
  const issued = [];
  const enc = new TextEncoder();
  const random = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  async function issue(request, { signWith = keys.privateKey, oracleKey = publicKey } = {}) {
    const traps = [];
    while (traps.length < request.count) {
      const a = random(26), stride = 1 + random(3), uniform = random(2) === 1;
      const prompt = Array.from({ length: request.promptLength }, (_, i) => uniform ? random(26) : (a + i * stride) % 26);
      const out = greedy(prompt, request.generate), all = [...prompt, ...out];
      const expectedLogits = Array.from({ length: request.generate }, (_, i) => toyLogits(all.slice(0, prompt.length + i)));
      if (expectedLogits.some(row => { const sorted = [...row].sort((x, y) => y - x); return sorted[0] - sorted[1] < 2.5; })) continue;
      traps.push({ id: `t${traps.length}`, prompt, continuation: out.slice(0, request.generate - 1), expectedLogits });
    }
    const batchId = hex(crypto.getRandomValues(new Uint8Array(16)));
    const body = { schema: 'doppler.protected-trap-batch/v1', batchId, circuit: CIRCUIT, model: MODEL, requesterNonce: request.requesterNonce,
      promptLength: request.promptLength, generate: request.generate, distribution: 'toy-mixture/v1',
      tolerance: { maxAbsLogitError: 0.75, minReferenceMargin: 2.5, requireArgmax: true }, traps };
    const eph = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
    const peer = await crypto.subtle.importKey('raw', fromBase64Url(request.requesterKey), { name: 'X25519' }, false, []);
    const shared = await crypto.subtle.deriveBits({ name: 'X25519', public: peer }, eph.privateKey, 256);
    const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
    const salt = Uint8Array.from(request.requesterNonce.match(/../g), b => parseInt(b, 16));
    const aes = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('doppler.protected-trap-batch/v1') }, ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(batchId) }, aes, enc.encode(JSON.stringify(body))));
    const header = JSON.stringify({ schema: 'doppler.protected-trap-batch/v1', batchId, circuit: CIRCUIT, requesterNonce: request.requesterNonce,
      requesterKey: request.requesterKey, oracleEphemeralKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey))),
      iv: toBase64Url(iv), ciphertextDigest: await sha(sealed), issuedAt: Date.now(), expiresAt: Date.now() + 600000 });
    const signature = toBase64Url(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, signWith,
      new Uint8Array([...enc.encode('doppler.protected-trap-batch/v1\x00'), ...enc.encode(header)]))));
    const envelope = { schema: 'doppler.protected-trap-batch-envelope/v1', header, ciphertext: toBase64Url(sealed), oracleKey, signature };
    issued.push({ request, envelope, traps });
    return envelope;
  }
  return { publicKey, issue, issued };
}

/** Fake key holder: "ciphertexts" are [tag, token, 14 random bytes]; decrypt reads back logits blobs. */
function fakeKeyHolder({ keysDigest = null } = {}) {
  const stats = { encryptions: 0, decryptions: 0 };
  return {
    stats, profileDigest: PROFILE,
    epoch: { id: 'a'.repeat(32), expiresAt: Math.floor(Date.now() / 1000) + 3600, keysDigest, reused: !!keysDigest },
    async generateKeys(onKey) {
      const blobs = Array.from({ length: 7 }, (_, i) => new Uint8Array([i, 7, 7]));
      for (const blob of blobs) await onKey(blob);
      return sha(new Uint8Array(blobs.flatMap(b => [...b])));
    },
    async commitKeys() {},
    async encrypt(tokens) { stats.encryptions += tokens.length; return tokens.map(t => new Uint8Array([0xce, t, ...crypto.getRandomValues(new Uint8Array(14))])); },
    async decrypt(blob) { if (blob.length !== 8 * VOCAB) return null; stats.decryptions++; return decodeLogits(blob); },
    async close() { return { ...stats }; }
  };
}

/** Fake engine. `lie(lane)` adds 20 to symbol 'z' for that lane (a valid-looking wrong answer). */
/** `vanishOn`: published trap prompts; the engine perturbs every lane whose prompt is not one of them (the attack). */
function fakeEngine({ lie = () => false, nanLane = -1, vanishOn = null } = {}) {
  return {
    async open({ lanes }) {
      const histories = Array.from({ length: lanes }, () => []);
      const promptLengths = [];
      const received = [];
      return {
        manifest: { profileDigest: PROFILE, circuit: CIRCUIT, heldKeysDigest: '', rotations: [1, 2, 4, 8, 16, 32] }, keyCount: 7,
        async sendKey(blob) { received.push(...blob); }, async keysHeld() {},
        async ready() { return sha(new Uint8Array(received)); },
        async step({ blobs, seq }) {
          const per = blobs.length / lanes;
          return histories.map((history, lane) => {
            history.push(...blobs.slice(lane * per, (lane + 1) * per).map(b => b[1]));
            if (seq === 1) promptLengths[lane] = per;
            const logits = toyLogits(history);
            if (lie(lane)) logits[25] += 20;
            if (vanishOn && !vanishOn.has(history.slice(0, promptLengths[lane]).join(','))) logits[25] += 20;
            if (lane === nanLane) logits.fill(NaN);
            return encodeLogits(logits);
          });
        },
        async close() {}
      };
    }
  };
}

const manifest = { protocol: 'toy-engine/v0', implementation: 'fake', scheme: 'ckks-rns-single-key', profile: 'toy-n12', profileDigest: PROFILE,
  circuit: CIRCUIT, model: MODEL, vocab: VOCAB, context: CONTEXT, inputLevel: 36, logSlots: 6, rotations: [1, 2, 4, 8, 16, 32], maxLanes: 8 };

async function setup({ engine = fakeEngine(), misbehave = null, wrongIdentity = false, tap = null, insecure = false, allowInsecure = false,
  extraAdvertisements = [], now = Date.now, keyHolder = () => fakeKeyHolder(), trapLanes = 3, randomInt,
  trapSource = 'oracle', allowPublicTrapSet = false, oracleAnswer = null, publicSet = null } = {}) {
  const oracle = await fakeOracle();
  const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
  const signingIdentity = wrongIdentity ? await createSigningIdentity({ algorithm: 'ECDSA' }) : identity;
  let advertisement = await createProtectedAdvertisement({ identity, manifest });
  const { envelope, publicKey } = publicSet ?? await signedTrapSet();
  const seenNonces = new Map(), evaluatorJournal = createProtectedJournal();
  const counts = { discover: 0, connect: 0, sessions: [] };
  const served = [];
  const serve = channel => {
    const run = serveProtectedEvaluatorSession({ channel, identity, advertisement, backend: engine, seenNonces, journal: evaluatorJournal, misbehave, signingIdentity });
    served.push(run);
    return run;
  };
  const policy = { protocols: ['reploid.protected-generation/v1'], engines: ['toy-engine/v0'],
    parameterSets: [{ id: 'toy-n12', digest: PROFILE, insecureDevelopment: insecure }], allowInsecureDevelopment: allowInsecure,
    circuits: [{ identity: CIRCUIT, modelIdentity: MODEL, tokenizer: { alphabet: ALPHABET }, vocab: VOCAB, context: CONTEXT, inputLevel: 36, logSlots: 6,
      rotations: [1, 2, 4, 8, 16, 32], traps: trapSource === 'oracle' ? { source: 'oracle', endpoint: 'oracle:1', oracleKeys: [oracle.publicKey] }
        : { source: 'public-set', envelope, publisherKeys: [publicKey] } }],
    trapLanes, maxTrapTolerance: 1, maxKeyEpochSeconds: 86400, allowPublicTrapSet };
  let holder = null;
  const requesterJournal = createProtectedJournal();
  const protectedExecution = createProtectedExecution({ policy, journal: requesterJournal, now, randomInt,
    async discover() {
      counts.discover++;
      const [mine, theirs] = createMemoryFrameChannelPair();
      serve(theirs);
      return [{ endpoint: 'mem:1', advertisement: await requestProtectedAdvertisement(mine) }, ...extraAdvertisements];
    },
    async connect() {
      counts.connect++;
      const [requester, evaluator] = createMemoryFrameChannelPair();
      if (!tap) { serve(evaluator); return requester; }
      // A network position between the two: `tap(frame, direction)` may rewrite or drop frames.
      const [proxyToEvaluator, evaluatorSide] = createMemoryFrameChannelPair();
      serve(evaluatorSide);
      const pump = async (from, to, direction) => { try { for (;;) { const frame = await tap(await from.receive({ timeoutMs: 5000 }), direction); if (frame) await to.send(frame); } } catch { from.close(); to.close(); } };
      pump(evaluator, proxyToEvaluator, 'up'); pump(proxyToEvaluator, evaluator, 'down');
      return requester;
    },
    async openCrypto() { holder = keyHolder(); return holder; },
    async requestTraps({ request }) { counts.oracle = (counts.oracle ?? 0) + 1; return oracleAnswer ? oracleAnswer(request, oracle) : oracle.issue(request); }
  });
  const inference = createInference({ resolveRoute() { throw new Error('plaintext route used'); }, execute() { throw new Error('plaintext executor used'); },
    now, protectedExecution, unreviewedProtectedExecution: true });
  const publicPrompts = new Set(JSON.parse(envelope.body).traps.map(trap => trap.prompt.join(',')));
  return { inference, identity, counts, served, evaluatorJournal, requesterJournal, holder: () => holder, advertisement: () => advertisement,
    setAdvertisement: value => { advertisement = value; }, policy, envelope, oracle, publicPrompts };
}

const execution = { placement: 'network-allowed', participants: { kind: 'open' }, confidentiality: 'requester-only', allowMetadata: ['model-id', 'timing', 'length'] };
const prepareInput = (overrides = {}) => ({ model: { id: 'toy', identity: MODEL }, generation: { maxOutputTokens: 4 }, execution, ...overrides });
async function runToEnd(inference, plan, content = 'bdf', requestId = 'r1') {
  const handle = await inference.run({ planId: plan.id, requestId, input: { messages: [{ role: 'user', content }] } });
  const events = [];
  for await (const event of handle.events) events.push(event);
  return { events, result: await handle.result };
}
const toText = tokens => tokens.map(t => ALPHABET[t]).join('');

describe('protected route flag', () => {
  it('without the flag, requester-only is refused before discovery and nothing is sent', async () => {
    const { counts } = await setup();
    let discovered = 0;
    let asked = 0;
    const port = createProtectedExecution({ policy: (await setup()).policy, discover: async () => { discovered++; return []; }, connect: async () => { throw new Error('sent'); },
      openCrypto: async () => { throw new Error('opened'); }, requestTraps: async () => { asked++; throw new Error('asked'); } });
    for (const inference of [
      createInference({ resolveRoute() { throw new Error('x'); }, execute() { throw new Error('x'); } }),
      createInference({ resolveRoute() { throw new Error('x'); }, execute() { throw new Error('x'); }, protectedExecution: port }),
      createInference({ resolveRoute() { throw new Error('x'); }, execute() { throw new Error('x'); }, protectedExecution: port, unreviewedProtectedExecution: 'yes' })
    ]) {
      await expect(inference.prepare(prepareInput())).rejects.toMatchObject({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE', reason: 'awaiting independent security review' });
    }
    expect(discovered).toBe(0);
    expect(asked).toBe(0);
    expect(counts.connect).toBe(0);
    expect(PROTECTED_EXECUTION_STATUS).toEqual({ available: false, reason: 'awaiting independent security review' });
  });
});

describe('prepare', () => {
  it('finds the eligible backend without any content and states who can read it and what leaks', async () => {
    const { inference, counts, identity } = await setup();
    const plan = await inference.prepare(prepareInput());
    expect(counts).toMatchObject({ discover: 1, connect: 0 });
    expect(plan.route).toMatchObject({ backend: 'doppler-protected-ckks/v1', protocol: 'reploid.protected-generation/v1', shape: 'remote',
      selection: 'one-of', participants: [identity.peerId], protected: { circuit: CIRCUIT, parameterSet: PROFILE, lanes: 4, trapLanes: 3 } });
    expect(plan.disclosures).toMatchObject({ contentReadableBy: { requesterDevice: true, participants: [] }, executorsReadContent: false,
      metadata: ['model-id', 'timing', 'length'], review: { available: false, reason: 'awaiting independent security review' } });
    expect(plan.disclosures.confidentiality).toEqual({ status: 'target-not-established', reason: 'parameters not estimated; awaiting independent security review' });
    expect(plan.disclosures.statement).toMatch(/Target, not established/);
    expect(plan.disclosures.statement).not.toMatch(/Only this device can read|even if every remote party colludes/);
  });

  it('an insecure development parameter set is disclosed as no confidentiality, with the evaluator as a reader', async () => {
    const { inference, identity } = await setup({ insecure: true, allowInsecure: true });
    const plan = await inference.prepare(prepareInput());
    expect(plan.disclosures).toMatchObject({ executorsReadContent: true, confidentiality: { status: 'none' },
      contentReadableBy: { requesterDevice: true, participants: [identity.peerId] } });
    expect(plan.disclosures.statement).toMatch(/NO confidentiality/);
    const { result } = await runToEnd(inference, plan);
    expect(result.executionReceipt.evidence.confidentiality).toMatchObject({ status: 'none', contentReadBy: { participants: [identity.peerId] } });
    expect(result.executionReceipt.evidence.confidentiality.notVerified).toEqual(expect.arrayContaining(['confidentiality', 'requester-held-key']));
  });

  it('refuses a route whose leakage the request does not allow', async () => {
    const { inference } = await setup();
    await expect(inference.prepare(prepareInput({ execution: { ...execution, allowMetadata: ['model-id', 'length'] } })))
      .rejects.toMatchObject({ code: 'LEAKAGE_NOT_ALLOWED' });
  });

  it('uses only the requester allowlist: an insecure set, an unpinned model or a forged advertisement is ineligible', async () => {
    await expect((await setup({ insecure: true })).inference.prepare(prepareInput())).rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
    await expect((await setup()).inference.prepare(prepareInput({ model: { id: 'toy', identity: 'sha256:' + '9'.repeat(64) } })))
      .rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
    const other = await createSigningIdentity({ algorithm: 'ECDSA' });
    const forged = await createProtectedAdvertisement({ identity: other, manifest });
    const tampered = { ...forged, descriptor: { ...forged.descriptor, parameterSet: { id: 'toy-n12', digest: 'sha256:' + '8'.repeat(64) } } };
    const { inference } = await setup({ extraAdvertisements: [{ endpoint: 'mem:2', advertisement: tampered }] });
    const plan = await inference.prepare(prepareInput());
    expect(plan.route.participants).not.toContain(other.peerId);
    await expect((await setup()).inference.prepare(prepareInput({ execution: { ...execution, participants: { kind: 'named', ids: [other.peerId] } } })))
      .rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
    await expect((await setup()).inference.prepare(prepareInput({ execution: { ...execution, placement: 'local-only', participants: { kind: 'none' } } })))
      .rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
  });
});

describe('run', () => {
  it('streams the reference continuation after traps pass and returns separate confidentiality and integrity evidence', async () => {
    const { inference, requesterJournal, evaluatorJournal, holder } = await setup();
    const plan = await inference.prepare(prepareInput());
    const { events, result } = await runToEnd(inference, plan);
    const expected = toText(greedy([1, 3, 5], 4));
    expect(result.status).toBe('completed');
    expect(result.output.text).toBe(expected);
    expect(events.map(e => e.type)).toEqual(['admitted', 'output.delta', 'output.delta', 'output.delta', 'output.delta', 'completed']);
    const { confidentiality, integrity } = result.executionReceipt.evidence;
    expect(confidentiality).toMatchObject({ mode: 'requester-only', contentReadBy: { requesterDevice: true, participants: [] },
      review: { reason: 'awaiting independent security review' } });
    expect(confidentiality.notVerified).toContain('independent-security-review');
    const traps = integrity.verified.find(item => item.claim === 'known-answer-traps').value;
    expect(traps).toMatchObject({ lanes: 4, trapLanes: 3, checks: 12, passed: 12, detectionProbabilityPerSession: 0.75 });
    expect(integrity.decryptions).toEqual({ trap: 12, real: 4 });
    expect(result.executionReceipt.route.admittedRouteId).toMatch(/^sha256:/);
    expect(holder().stats.decryptions).toBe(16);
    // The protected journals hold digests and verdicts, never the prompt or the answer.
    const recorded = JSON.stringify([requesterJournal.entries(), evaluatorJournal.entries()]);
    expect(recorded).not.toContain('"bdf"');
    expect(recorded).not.toContain(expected);
    expect(recorded).not.toMatch(/"tokens"|"logits"|"text"/);
  });

  it('a plan runs once and an expired plan sends nothing', async () => {
    let time = Date.now();
    const { inference, counts } = await setup({ now: () => time });
    const plan = await inference.prepare(prepareInput());
    time += 10 * 60 * 1000;
    await expect(inference.run({ planId: plan.id, requestId: 'late', input: { messages: [{ role: 'user', content: 'bdf' }] } }))
      .rejects.toMatchObject({ code: 'EXECUTION_PLAN_EXPIRED' });
    expect(counts.connect).toBe(0);
  });

  it('a changed descriptor between prepare and run is EXECUTION_PLAN_CHANGED with nothing sent', async () => {
    const s = await setup();
    const plan = await s.inference.prepare(prepareInput());
    s.setAdvertisement(await createProtectedAdvertisement({ identity: s.identity, manifest: { ...manifest, implementation: 'fake-2' } }));
    await expect(s.inference.run({ planId: plan.id, requestId: 'c', input: { messages: [{ role: 'user', content: 'bdf' }] } }))
      .rejects.toMatchObject({ code: 'EXECUTION_PLAN_CHANGED' });
    expect(s.counts.connect).toBe(0);
  });

  it('an evaluator that cannot sign as the planned identity gets no keys and no ciphertext', async () => {
    const { inference, served } = await setup({ wrongIdentity: true });
    const { result } = await runToEnd(inference, await inference.prepare(prepareInput()));
    expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'EXECUTION_PLAN_CHANGED' } });
    expect(result.executionReceipt.evidence.integrity.decryptions).toEqual({ trap: 0, real: 0 });
    const session = (await Promise.all(served)).at(-1);
    expect(session.frames.key ?? 0).toBe(0);
    expect(session.frames.step ?? 0).toBe(0);
  });

  it('refuses a replayed result frame', async () => {
    const { inference } = await setup({ misbehave: 'replay-result' });
    const { result } = await runToEnd(inference, await inference.prepare(prepareInput()));
    expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'RESULT_UNVERIFIED' } });
    expect(result.error.message).toMatch(/sequence/);
    expect(result.executionReceipt.evidence.integrity.decryptions).toEqual({ trap: 3, real: 1 });
  });

  it('refuses a result tampered in transit before decrypting it', async () => {
    const tap = async (frame, direction) => {
      if (direction === 'down' && frame.header.kind === 'result' && frame.header.fields.step === 2) frame.blobs[1][3] ^= 1;
      return frame;
    };
    const { inference } = await setup({ tap });
    const { result } = await runToEnd(inference, await inference.prepare(prepareInput()));
    expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'RESULT_UNVERIFIED' } });
    expect(result.error.message).toMatch(/signed digest/);
    expect(result.executionReceipt.evidence.integrity.decryptions).toEqual({ trap: 3, real: 1 });
  });

  it('an evaluator lying on every lane fails a trap and the real result is never decrypted', async () => {
    const { inference, holder } = await setup({ engine: fakeEngine({ lie: () => true }) });
    const { result } = await runToEnd(inference, await inference.prepare(prepareInput()));
    expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'RESULT_UNVERIFIED' } });
    expect(result.executionReceipt.evidence.integrity.decryptions.real).toBe(0);
    expect(holder().stats.decryptions).toBe(1);
  });

  it('refuses an evaluator decrypt request without decrypting anything', async () => {
    const { inference, holder } = await setup({ misbehave: 'ask-decrypt' });
    const { result } = await runToEnd(inference, await inference.prepare(prepareInput()));
    expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'RESULT_UNVERIFIED' } });
    expect(result.error.message).toMatch(/decrypt-request/);
    expect(holder().stats.decryptions).toBe(0);
  });

  it('a dropped peer fails with no partial result', async () => {
    const tap = async (frame, direction) => {
      if (direction === 'down' && frame.header.kind === 'result' && frame.header.fields.step === 2) throw new Error('dropped');
      return frame;
    };
    const { inference } = await setup({ tap });
    const { events, result } = await runToEnd(inference, await inference.prepare(prepareInput()));
    expect(result).toMatchObject({ status: 'failed', output: null, usage: null, error: { code: 'PROTECTED_SESSION_CLOSED' } });
    expect(events.at(-1).type).toBe('failed');
  });

  it('a real lane with non-finite values does not end the session (no abort oracle on real content)', async () => {
    // randomInt 0 puts the real lane first; the engine returns NaN logits for that lane only.
    const { inference } = await setup({ engine: fakeEngine({ nanLane: 0 }), randomInt: () => 0 });
    const { result } = await runToEnd(inference, await inference.prepare(prepareInput()));
    expect(result.status).toBe('completed');
    expect(result.output.text).toBe('aaaa');
    expect(result.executionReceipt.evidence.integrity.decryptions).toEqual({ trap: 12, real: 4 });
    expect(totalArgmax([NaN, NaN, 1, NaN])).toBe(2);
    expect(totalArgmax([NaN, NaN])).toBe(0);
  });

  it('refuses a replayed bind offer at the evaluator', async () => {
    let offer = null;
    const tap = async (frame, direction) => { if (direction === 'up' && frame.header.kind === 'bind-offer') offer = structuredClone({ header: frame.header, blobs: [] }); return frame; };
    const s = await setup({ tap });
    await runToEnd(s.inference, await s.inference.prepare(prepareInput()));
    const [attacker, evaluator] = createMemoryFrameChannelPair();
    const session = serveProtectedEvaluatorSession({ channel: evaluator, identity: s.identity, advertisement: s.advertisement(),
      backend: fakeEngine(), seenNonces: new Map([[offer.header.fields.offer.requesterNonce, Date.now() + 60000]]) });
    await attacker.send(offer);
    expect(await session).toMatchObject({ outcome: 'failed', error: 'bind offer replayed' });
  });
});

describe('trap verification', () => {
  it('detects a liar that tampers one lane it cannot identify at the rate T/K', async () => {
    const trials = 200;
    let detected = 0;
    for (let i = 0; i < trials; i++) {
      const liar = Math.floor(Math.random() * 4);
      const { inference } = await setup({ engine: fakeEngine({ lie: lane => lane === liar }) });
      const { result } = await runToEnd(inference, await inference.prepare(prepareInput({ generation: { maxOutputTokens: 1 } })), 'bdf', `t${i}`);
      if (result.status === 'failed') { expect(result.error.code).toBe('RESULT_UNVERIFIED'); detected++; }
      else expect(result.output.text).not.toBe(toText(greedy([1, 3, 5], 1)));
    }
    const rate = detected / trials;
    expect(trapDetectionProbability({ lanes: 4, trapLanes: 3 })).toBe(0.75);
    // 200 Bernoulli(0.75) trials: mean 150, sd 6.1; the bound is about five standard deviations.
    expect(Math.abs(rate - 0.75)).toBeLessThan(0.16);
  }, 60000);

  it('a liar that knows the real lane is never caught: the guarantee rests on lanes being indistinguishable', async () => {
    const real = 2;
    const { inference } = await setup({ engine: fakeEngine({ lie: lane => lane === real }), randomInt: n => (n === 4 ? real : 0) });
    const { result } = await runToEnd(inference, await inference.prepare(prepareInput({ generation: { maxOutputTokens: 2 } })));
    expect(result.status).toBe('completed');
    expect(result.output.text).not.toBe(toText(greedy([1, 3, 5], 2)));
  });

  it('two or more tampered lanes are always caught with one real lane', () => {
    expect(trapDetectionProbability({ lanes: 4, trapLanes: 3, tampered: 2 })).toBe(1);
    expect(trapDetectionProbability({ lanes: 8, trapLanes: 7 })).toBeCloseTo(0.875);
    expect(trapDetectionProbability({ lanes: 2, trapLanes: 1 })).toBe(0.5);
  });

  it('checks tolerance and argmax, and plans one real lane among distinct traps', async () => {
    expect(checkTrapResult([0, 10, 0], [0.5, 10.5, 0], { maxAbsLogitError: 0.75 }).pass).toBe(true);
    expect(checkTrapResult([0, 10, 0], [0.8, 10, 0], { maxAbsLogitError: 0.75 }).pass).toBe(false);
    expect(checkTrapResult([0, 10, 9.5], [0, 9.6, 9.7], { maxAbsLogitError: 0.75 }).pass).toBe(false);
    const traps = [1, 2, 3, 4].map(i => ({ id: `t${i}`, prompt: [1, 2], continuation: [3, 4, 5, 6, 7, 8], expectedLogits: [] }));
    const lanes = planProtectedLanes({ trapSet: { traps }, promptLength: 2, generate: 3, trapLanes: 3 });
    expect(lanes.filter(l => l.kind === 'real')).toHaveLength(1);
    expect(new Set(lanes.filter(l => l.trap).map(l => l.trap.id)).size).toBe(3);
    expect(() => planProtectedLanes({ trapSet: { traps }, promptLength: 3, generate: 1, trapLanes: 3 })).toThrow(/Nothing was sent/);
  });

  it('frames decode incrementally and an oversized header kind is refused before its blobs', () => {
    const frames = [];
    const decoder = createFrameDecoder({ inspect: inspectProtectedHeader, onFrame: f => frames.push(f) });
    const bytes = encodeProtectedFrame({ schema: 'reploid.protected-generation/v1', kind: 'result', blobs: [{ bytes: 3 }, { bytes: 2 }] }, [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]);
    const flat = new Uint8Array(bytes.reduce((n, b) => n + b.length, 0));
    let o = 0; for (const b of bytes) { flat.set(b, o); o += b.length; }
    for (const byte of flat) decoder.push(new Uint8Array([byte]));
    expect(frames).toHaveLength(1);
    expect([...frames[0].blobs[1]]).toEqual([4, 5]);
    const bad = createFrameDecoder({ inspect: inspectProtectedHeader, onFrame: () => {} });
    const [prefix, header] = encodeProtectedFrame({ schema: 'reploid.protected-generation/v1', kind: 'bye', blobs: [{ bytes: 10 }] });
    expect(() => { bad.push(prefix); bad.push(header); }).toThrow(/ceiling/);
  });
});

describe('trap verification v2: secret fresh traps from a pinned oracle', () => {
  it('the vanishing perturbation passes undetected with a public trap set (v1) and is caught with oracle traps (v2)', async () => {
    // The attacker reads the published set and perturbs (+20 on symbol z) every prompt that is not in it.
    const published = await signedTrapSet();
    const listed = new Set(JSON.parse(published.envelope.body).traps.map(trap => trap.prompt.join(',')));
    const real = Array.from({ length: 26 }, (_, a) => [a, (a + 2) % 26, (a + 4) % 26]).find(p => !listed.has(p.join(',')));
    const v1 = await setup({ trapSource: 'public-set', allowPublicTrapSet: true, publicSet: published, engine: fakeEngine({ vanishOn: listed }) });
    const one = await runToEnd(v1.inference, await v1.inference.prepare(prepareInput()), toText(real));
    expect(one.result.status).toBe('completed');                       // every trap passed
    expect(one.result.output.text).not.toBe(toText(greedy(real, 4)));
    expect(one.result.output.text).toBe('zzzz');                       // and the real answer is the attacker's
    // v2: the same attacker and the same published set; this requester's traps are secret and fresh.
    for (let i = 0; i < 20; i++) {
      const v2 = await setup({ engine: fakeEngine({ vanishOn: listed }) });
      const two = await runToEnd(v2.inference, await v2.inference.prepare(prepareInput({ generation: { maxOutputTokens: 1 } })), toText(real), `v2-${i}`);
      expect(two.result).toMatchObject({ status: 'failed', output: null, error: { code: 'RESULT_UNVERIFIED' } });
      expect(two.result.executionReceipt.evidence.integrity.decryptions.real).toBe(0);
    }
  }, 60000);

  it('refuses a batch signed by an unpinned oracle key, or altered after signing, and sends nothing to the evaluator', async () => {
    const forgedKey = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const forgedPublic = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', forgedKey.publicKey)));
    for (const oracleAnswer of [
      (request, oracle) => oracle.issue(request, { signWith: forgedKey.privateKey, oracleKey: forgedPublic }),   // another oracle
      (request, oracle) => oracle.issue(request, { signWith: forgedKey.privateKey }),                            // claims the pinned key
      async (request, oracle) => { const e = await oracle.issue(request); return { ...e, header: e.header.replace('"expiresAt":', '"expiresAt":1') }; },
      async (request, oracle) => { const e = await oracle.issue(request); const c = fromBase64Url(e.ciphertext); c[5] ^= 1; return { ...e, ciphertext: toBase64Url(c) }; }
    ]) {
      const s = await setup({ oracleAnswer });
      const { result } = await runToEnd(s.inference, await s.inference.prepare(prepareInput()));
      expect(result).toMatchObject({ status: 'failed', output: null, error: { code: 'EXECUTION_ROUTE_UNAVAILABLE' } });
      expect(result.error.message).toMatch(/Trap batch refused/);
      expect(s.counts.connect).toBe(0);
    }
  });

  it('refuses a stale batch replayed into a later session', async () => {
    let first = null;
    const s = await setup({ oracleAnswer: async (request, oracle) => first ?? (first = await oracle.issue(request)) });
    const one = await runToEnd(s.inference, await s.inference.prepare(prepareInput()), 'bdf', 'first');
    expect(one.result.status).toBe('completed');
    const connectsBefore = s.counts.connect;
    const two = await runToEnd(s.inference, await s.inference.prepare(prepareInput()), 'bdf', 'second');
    expect(two.result).toMatchObject({ status: 'failed', error: { code: 'EXECUTION_ROUTE_UNAVAILABLE' } });
    expect(two.result.error.message).toMatch(/stale or replayed/);
    expect(s.counts.connect).toBe(connectsBefore);
  });

  it('asks the oracle only for sizes: circuit, prompt length, generated count, trap count, a nonce and a one-time key', async () => {
    const s = await setup();
    const { result } = await runToEnd(s.inference, await s.inference.prepare(prepareInput()), 'bdf');
    expect(result.status).toBe('completed');
    const [{ request }] = s.oracle.issued;
    expect(Object.keys(request).sort()).toEqual(['circuit', 'count', 'generate', 'promptLength', 'requesterKey', 'requesterNonce', 'schema']);
    expect(request).toMatchObject({ promptLength: 3, generate: 4, count: 3 });
    expect(JSON.stringify(request)).not.toMatch(/bdf|\[1,3,5\]/);
    const traps = result.executionReceipt.evidence.integrity.verified.find(item => item.claim === 'known-answer-traps');
    expect(traps.method).toMatch(/secret-fresh-traps/);
    expect(traps.value).toMatchObject({ source: 'oracle', passed: 12 });
    expect(result.executionReceipt.evidence.integrity.notVerified).toContain('trap-oracle-independence-from-the-evaluator');
  });

  it('a public trap set is ineligible unless explicitly allowed for comparison', async () => {
    const s = await setup({ trapSource: 'public-set' });
    await expect(s.inference.prepare(prepareInput())).rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
  });
});
