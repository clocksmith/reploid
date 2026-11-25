// @vitest-environment node
/**
 * reploid.protected-generation/v1 with in-process fakes: a fake key holder whose "ciphertexts" are tagged tokens
 * and a fake engine computing a fixed toy model. These pin the protocol (eligibility, binding, frames, traps,
 * flag) and the trap detection rate cheaply; tests/integration/protected-route.test.js runs the real CKKS backend.
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
function fakeEngine({ lie = () => false, nanLane = -1 } = {}) {
  return {
    async open({ lanes }) {
      const histories = Array.from({ length: lanes }, () => []);
      const received = [];
      return {
        manifest: { profileDigest: PROFILE, circuit: CIRCUIT, heldKeysDigest: '', rotations: [1, 2, 4, 8, 16, 32] }, keyCount: 7,
        async sendKey(blob) { received.push(...blob); }, async keysHeld() {},
        async ready() { return sha(new Uint8Array(received)); },
        async step({ blobs }) {
          const per = blobs.length / lanes;
          return histories.map((history, lane) => {
            history.push(...blobs.slice(lane * per, (lane + 1) * per).map(b => b[1]));
            const logits = toyLogits(history);
            if (lie(lane)) logits[25] += 20;
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
  extraAdvertisements = [], now = Date.now, keyHolder = () => fakeKeyHolder(), trapLanes = 3, randomInt } = {}) {
  const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
  const signingIdentity = wrongIdentity ? await createSigningIdentity({ algorithm: 'ECDSA' }) : identity;
  let advertisement = await createProtectedAdvertisement({ identity, manifest });
  const { envelope, publicKey } = await signedTrapSet();
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
      rotations: [1, 2, 4, 8, 16, 32], trapSet: envelope, trapPublisherKeys: [publicKey] }],
    trapLanes, maxTrapTolerance: 1, maxKeyEpochSeconds: 86400 };
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
    async openCrypto() { holder = keyHolder(); return holder; }
  });
  const inference = createInference({ resolveRoute() { throw new Error('plaintext route used'); }, execute() { throw new Error('plaintext executor used'); },
    now, protectedExecution, unreviewedProtectedExecution: true });
  return { inference, identity, counts, served, evaluatorJournal, requesterJournal, holder: () => holder, advertisement: () => advertisement, setAdvertisement: value => { advertisement = value; }, policy, envelope };
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
    const port = createProtectedExecution({ policy: (await setup()).policy, discover: async () => { discovered++; return []; }, connect: async () => { throw new Error('sent'); }, openCrypto: async () => { throw new Error('opened'); } });
    for (const inference of [
      createInference({ resolveRoute() { throw new Error('x'); }, execute() { throw new Error('x'); } }),
      createInference({ resolveRoute() { throw new Error('x'); }, execute() { throw new Error('x'); }, protectedExecution: port }),
      createInference({ resolveRoute() { throw new Error('x'); }, execute() { throw new Error('x'); }, protectedExecution: port, unreviewedProtectedExecution: 'yes' })
    ]) {
      await expect(inference.prepare(prepareInput())).rejects.toMatchObject({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE', reason: 'awaiting independent security review' });
    }
    expect(discovered).toBe(0);
    expect(counts.connect).toBe(0);
    expect(PROTECTED_EXECUTION_STATUS).toEqual({ available: false, reason: 'awaiting independent security review' });
  });
});

describe('prepare', () => {
  it('finds the eligible backend without any content and states who can read it and what leaks', async () => {
    const { inference, counts, identity } = await setup({ insecure: true, allowInsecure: true });
    const plan = await inference.prepare(prepareInput());
    expect(counts).toMatchObject({ discover: 1, connect: 0 });
    expect(plan.route).toMatchObject({ backend: 'doppler-protected-ckks/v1', protocol: 'reploid.protected-generation/v1', shape: 'remote',
      selection: 'one-of', participants: [identity.peerId], protected: { circuit: CIRCUIT, parameterSet: PROFILE, lanes: 4, trapLanes: 3 } });
    expect(plan.disclosures).toMatchObject({ contentReadableBy: { requesterDevice: true, participants: [] }, executorsReadContent: false,
      metadata: ['model-id', 'timing', 'length'], review: { available: false, reason: 'awaiting independent security review' } });
    expect(plan.disclosures.leaks).toContain('prompt length and generated token count');
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
