// @vitest-environment node
/**
 * The attested GPU verifier and session with SYNTHETIC fixture reports (tests/helpers/attested-gpu-fixtures.js):
 * real structures, test-only keys. Every rejection must happen before the prompt is sealed: the host never
 * receives a `request` frame and its runtime never sees a message.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { X509Certificate } from 'node:crypto';
import { createSyntheticWorld, syntheticHost, SYNTHETIC_MODEL, SYNTHETIC_MEASUREMENTS, makeCertificate, makeTdxQuote, ecKey } from '../helpers/attested-gpu-fixtures.js';
import { runAttestedRequesterSession, serveAttestedSession, createAttestedChannelPair, inspectAttestedHeader } from '../../packages/reploid/src/inference/attested/session.js';
import { validateAttestedPolicy, ATTESTATION_REASONS } from '../../packages/reploid/src/inference/attested/verifier.js';
import { parseCertificate, verifyCertificateChain } from '../../packages/reploid/src/inference/attested/x509.js';
import { parseTdxQuote } from '../../packages/reploid/src/inference/attested/reports.js';
import { toHex } from '../../packages/reploid/src/inference/attested/bytes.js';
import { encodeAttestedFrame, decodeAttestedFrame } from '../../packages/reploid/src/inference/attested/websocket-channel.js';

let world, expiredWorld;
beforeAll(async () => {
  world = await createSyntheticWorld();
  expiredWorld = await createSyntheticWorld({ expireGpuLeaf: true });
}, 60000);

/** One session. `tamper(frame)` may rewrite frames from requester to host (a network attacker or a replayed challenge). */
async function attempt({ w = world, platform = 'amd-sev-snp', faults = {}, policy = w.policy, tamper = null, requesterNow = w.now, validate = true } = {}) {
  const [requester, hostEnd] = createAttestedChannelPair();
  const seen = [];
  const hostChannel = { ...hostEnd, receive: async options => { const value = await hostEnd.receive(options); seen.push(value.header.kind); return tamper ? tamper(value) : value; } };
  const record = {};
  const served = serveAttestedSession({ channel: hostChannel, host: syntheticHost(w, { platform, faults, record }), now: () => w.now });
  let result = null, error = null;
  try {
    result = await runAttestedRequesterSession({ channel: requester, policy: validate ? validateAttestedPolicy(policy) : policy, model: SYNTHETIC_MODEL, requestId: 'r1',
      messages: [{ role: 'user', content: 'SENSITIVE build log' }], generation: { maxOutputTokens: 64 }, now: () => requesterNow, timeoutMs: 5000 });
  } catch (caught) { error = caught; }
  return { result, error, record, hostFrames: seen, host: await served };
}
const expectRejected = (outcome, reason) => {
  expect(outcome.error).toMatchObject({ code: 'ATTESTATION_REJECTED', reason });
  expect(outcome.hostFrames).not.toContain('request');
  expect(outcome.record.messages).toBeUndefined();
  expect(outcome.host.outcome).toBe('aborted');
};

describe('synthetic fixtures are real X.509', () => {
  it('parses and validates every chain, and Node agrees on every signature', async () => {
    for (const chain of [world.chains.gpu, world.chains.amd, world.chains.intelPck]) {
      for (let i = 0; i < chain.length; i += 1) {
        const node = new X509Certificate(Buffer.from(chain[i]));
        const issuer = new X509Certificate(Buffer.from(chain[Math.min(i + 1, chain.length - 1)]));
        expect(node.verify(issuer.publicKey)).toBe(true);
        expect(parseCertificate(chain[i]).subjectName).toMatch(/^Synthetic .* \(test only\)$/);
      }
    }
    const roots = [...world.policy.roots.nvidiaDevice];
    await expect(verifyCertificateChain(world.chains.gpu, { roots, now: world.now })).resolves.toHaveLength(4);
  });
});

describe('attested GPU session: valid evidence', () => {
  it.each(['amd-sev-snp', 'intel-tdx'])('%s: verifies, then seals the prompt to the bound key and streams the answer', async platform => {
    const outcome = await attempt({ platform });
    expect(outcome.error).toBeNull();
    expect(outcome.result.output.text).toMatch(/^Diagnosis:/);
    expect(outcome.record.messages).toEqual([{ role: 'user', content: 'SENSITIVE build log' }]);
    expect(outcome.result.attestation).toMatchObject({ platform, participantId: 'peer:attested-synthetic', gpus: [{ ccMode: 'on', architecture: 'hopper' }] });
    expect(outcome.hostFrames).toEqual(['challenge', 'request']);
    expect(outcome.result.attestation.notChecked).toContain('cpu-certificate-revocation');
    if (platform === 'intel-tdx') expect(outcome.result.attestation.notChecked).toEqual(expect.arrayContaining(['tdx-tcb-status', 'runtime-and-model-measured-only-by-the-executor-itself']));
  });
});

describe('attested GPU session: every failure is refused before the prompt is sealed', () => {
  it('wrong nonce (a replayed or substituted challenge)', async () => {
    const tamper = value => value.header.kind === 'challenge' ? { ...value, header: { ...value.header, nonce: Buffer.alloc(32, 7).toString('base64url') } } : value;
    expectRejected(await attempt({ tamper }), 'nonce-mismatch');
  });
  it('stale evidence', async () => {
    expectRejected(await attempt({ requesterNow: world.now + 10 * 60000 }), 'evidence-stale');
  });
  it.each(['amd-sev-snp', 'intel-tdx'])('%s: unknown launch measurement', async platform => {
    expectRejected(await attempt({ platform, faults: { measurement: 'ab'.repeat(48) } }), 'measurement-unknown');
  });
  it.each([0, 1, 2])('intel-tdx: RTMR%i that differs from the pinned one', async index => {
    const rtmr = [...SYNTHETIC_MEASUREMENTS.rtmr.slice(0, 3), 'ee'.repeat(48)];
    rtmr[index] = 'ab'.repeat(48);
    expectRejected(await attempt({ platform: 'intel-tdx', faults: { rtmr } }), 'measurement-unknown');
  });
  it('intel-tdx: RTMR3 is compared only when the policy pins it', async () => {
    const rtmr = [...SYNTHETIC_MEASUREMENTS.rtmr.slice(0, 3), 'ee'.repeat(48)];
    expect((await attempt({ platform: 'intel-tdx', faults: { rtmr } })).error).toBeNull();
    const policy = structuredClone(world.policy);
    policy.launches[1].measurement.rtmr[3] = 'dd'.repeat(48);
    expectRejected(await attempt({ platform: 'intel-tdx', faults: { rtmr }, policy }), 'measurement-unknown');
  });
  it('TDX quote signed by a quoting enclave other than the pinned one', async () => {
    // A PCK certificate vouches for any enclave its platform certified, so the signer and product must be Intel's.
    expectRejected(await attempt({ platform: 'intel-tdx', faults: { qe: { mrSigner: 'c7'.repeat(32) } } }), 'quoting-enclave-unknown');
    expectRejected(await attempt({ platform: 'intel-tdx', faults: { qe: { isvProdId: 1 } } }), 'quoting-enclave-unknown');
  });
  it('TDX quote checked under a policy that pins no quoting enclave', async () => {
    const { tdxQe, ...unpinned } = world.policy;
    expectRejected(await attempt({ platform: 'intel-tdx', policy: unpinned, validate: false }), 'quoting-enclave-unknown');
  });
  it('TDX quote signed by a debug quoting enclave', async () => {
    expectRejected(await attempt({ platform: 'intel-tdx', faults: { qe: { debug: true } } }), 'debug-enabled');
  });
  it('TDX quoting enclave older than the policy minimum', async () => {
    expectRejected(await attempt({ platform: 'intel-tdx', faults: { qe: { isvSvn: 3 } } }), 'tcb-out-of-date');
  });
  it('SEV-SNP guest launched with DEBUG allowed', async () => {
    expectRejected(await attempt({ faults: { snpDebug: true } }), 'debug-enabled');
  });
  it('TDX trust domain launched with DEBUG', async () => {
    expectRejected(await attempt({ platform: 'intel-tdx', faults: { tdxDebug: true } }), 'debug-enabled');
  });
  it('GPU in developer-tools (debug) mode', async () => {
    expectRejected(await attempt({ faults: { devToolsMode: true, ccMode: 'devtools' } }), 'debug-enabled');
  });
  it('GPU not in confidential-computing mode', async () => {
    expectRejected(await attempt({ faults: { ccMode: 'off' } }), 'gpu-not-cc');
  });
  it.each(['amd-sev-snp', 'intel-tdx'])('%s: CPU report that does not bind the executor key', async platform => {
    expectRejected(await attempt({ platform, faults: { unboundKey: true } }), 'key-unbound');
  });
  it('expired GPU attestation certificate', async () => {
    expectRejected(await attempt({ w: expiredWorld }), 'certificate-expired');
  });
  it('revoked GPU certificate (stapled OCSP says revoked)', async () => {
    expectRejected(await attempt({ faults: { revokedLeaf: true } }), 'certificate-revoked');
  });
  it('stale OCSP response', async () => {
    expectRejected(await attempt({ faults: { staleOcsp: true } }), 'revocation-unchecked');
  });
  it('GPU measurements that match no RIM reference set', async () => {
    expectRejected(await attempt({ faults: { gpuMeasurements: { ...SYNTHETIC_MEASUREMENTS.gpu, 9: 'cd'.repeat(48) } } }), 'gpu-measurement-unknown');
  });
  it('tampered GPU report signature', async () => {
    expectRejected(await attempt({ faults: { badGpuSignature: true } }), 'signature-invalid');
  });
  it('a chain that ends at an unpinned root', async () => {
    const policy = structuredClone(world.policy);
    policy.roots.nvidiaDevice = ['sha256:' + 'e'.repeat(64)];
    expectRejected(await attempt({ policy }), 'certificate-invalid');
  });
  it('a launch serving another model', async () => {
    const outcome = await attempt({ faults: { model: { id: 'other-model', identity: 'sha256:' + '9'.repeat(64) } } });
    expect(outcome.error).toMatchObject({ code: 'ATTESTED_SESSION_REFUSED' });
    expect(outcome.record.messages).toBeUndefined();
  });
  it('CPU revocation named as a hook but not configured', async () => {
    expectRejected(await attempt({ policy: { ...world.policy, revocation: { ...world.policy.revocation, cpu: 'hook' } } }), 'revocation-unchecked');
  });
  it('lists every reason it can return', () => {
    expect(ATTESTATION_REASONS).toEqual(expect.arrayContaining(['nonce-mismatch', 'measurement-unknown', 'debug-enabled', 'key-unbound', 'certificate-expired', 'gpu-not-cc']));
  });
});

describe('attested GPU session: after binding', () => {
  it('a response frame altered in transit ends the run with no answer', async () => {
    const [requester, hostEnd] = createAttestedChannelPair();
    const hostChannel = { ...hostEnd, send: async value => {
      if (value.header.kind === 'delta' && value.header.sequence === 1) value.blobs[0][3] ^= 0xff;
      return hostEnd.send(value);
    } };
    serveAttestedSession({ channel: hostChannel, host: syntheticHost(world, {}), now: () => world.now });
    await expect(runAttestedRequesterSession({ channel: requester, policy: world.policy, model: SYNTHETIC_MODEL, requestId: 'r', messages: [{ role: 'user', content: 'x' }],
      generation: {}, now: () => world.now, timeoutMs: 5000 })).rejects.toMatchObject({ code: 'ATTESTED_PROTOCOL_VIOLATION' });
  });
  it('a runtime failure returns only a code', async () => {
    const [requester, hostEnd] = createAttestedChannelPair();
    serveAttestedSession({ channel: hostEnd, host: syntheticHost(world, { faults: { failRuntime: true } }), now: () => world.now });
    await expect(runAttestedRequesterSession({ channel: requester, policy: world.policy, model: SYNTHETIC_MODEL, requestId: 'r', messages: [{ role: 'user', content: 'x' }],
      generation: {}, now: () => world.now, timeoutMs: 5000 })).rejects.toMatchObject({ code: 'ATTESTED_RUNTIME_FAILED' });
  });
});

describe('report layouts', () => {
  // Offsets in the TD quote body are Intel's (TDX DCAP quote v4, sgx_report2_body_t), stated here independently
  // of the fixture builder: the body starts after the 48-byte header.
  it('reads MRTD, every RTMR and REPORTDATA of a TDX quote v4 at their own offsets', async () => {
    const fill = byte => toHex(new Uint8Array(48).fill(byte));
    const rtmr = [fill(0xa0), fill(0xa1), fill(0xa2), fill(0xa3)];
    const reportData = new Uint8Array(64).fill(0x5d);
    const raw = await makeTdxQuote({ reportData, mrTd: fill(0x3d), rtmr, attestationKey: world.keys.qeAttestation, pck: world.keys.pck, pckChainDer: world.chains.intelPck });
    const at = (offset, length) => toHex(raw.subarray(48 + offset, 48 + offset + length));
    expect(at(136, 48)).toBe(fill(0x3d));
    expect([328, 376, 424, 472].map(offset => at(offset, 48))).toEqual(rtmr);
    expect(at(520, 64)).toBe(toHex(reportData));
    const quote = parseTdxQuote(raw);
    expect(quote.mrTd).toBe(fill(0x3d));
    expect(quote.rtmr).toEqual(rtmr);
    expect(toHex(quote.reportData)).toBe(toHex(reportData));
  });
});

describe('policy and framing', () => {
  it('refuses a policy without pinned NVIDIA roots, coverage or bounded counts', () => {
    expect(() => validateAttestedPolicy({ ...world.policy, roots: { ...world.policy.roots, nvidiaDevice: [] } })).toThrow(/NVIDIA device root/);
    expect(() => validateAttestedPolicy({ ...world.policy, launches: [{ ...world.policy.launches[0], coverage: undefined }] })).toThrow(/coverage/);
    expect(() => validateAttestedPolicy({ ...world.policy, gpu: { ...world.policy.gpu, maxCount: 0 } })).toThrow(/count/);
  });
  it('requires a pinned quoting enclave for every TDX launch, and only for TDX', () => {
    const { tdxQe, ...unpinned } = world.policy;
    expect(() => validateAttestedPolicy(unpinned)).toThrow(/tdxQe/);
    expect(() => validateAttestedPolicy({ ...world.policy, tdxQe: { ...tdxQe, mrSigner: [] } })).toThrow(/tdxQe/);
    expect(() => validateAttestedPolicy({ ...world.policy, tdxQe: { mrSigner: tdxQe.mrSigner, isvProdId: 2 } })).toThrow(/tdxQe/);
    expect(validateAttestedPolicy({ ...unpinned, launches: [world.policy.launches[0]] }).tdxQe).toBeUndefined();
  });
  it('bounds frames before buffering and round-trips the wire encoding', () => {
    expect(() => inspectAttestedHeader({ schema: 'reploid.attested-gpu/v1', kind: 'delta', blobs: [1 << 20] })).toThrow(/ceiling/);
    expect(() => inspectAttestedHeader({ schema: 'reploid.attested-gpu/v1', kind: 'decrypt', blobs: [] })).toThrow(/Unrecognized/);
    const frame = { header: { schema: 'reploid.attested-gpu/v1', kind: 'delta', sequence: 0, blobs: [3] }, blobs: [Uint8Array.of(1, 2, 3)] };
    expect(decodeAttestedFrame(encodeAttestedFrame(frame))).toEqual(frame);
  });
  it('rejects a self-signed leaf posing as a chain', async () => {
    const key = await ecKey('P-384');
    const fake = await makeCertificate({ cn: 'Synthetic impostor (test only)', key, scheme: 'ecdsa-SHA-384', ca: true, notBefore: world.now - 1000, notAfter: world.now + 1e9 });
    await expect(verifyCertificateChain([fake], { roots: world.policy.roots.nvidiaDevice, now: world.now })).rejects.toMatchObject({ code: 'CERTIFICATE_ROOT_UNPINNED' });
  });
});
