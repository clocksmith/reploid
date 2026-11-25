/**
 * SYNTHETIC attestation fixtures for the attested GPU route. Nothing here is real AMD, Intel or NVIDIA evidence:
 * every key is generated in the test process and every certificate's common name says "Synthetic ... (test only)".
 * The structures are the real ones (X.509 DER, OCSP BasicOCSPResponse, SEV-SNP report v3 layout, TDX quote v4,
 * NVIDIA SPDM GET_MEASUREMENTS request || MEASUREMENTS response), so the verifier's parsers run unchanged.
 */
import { concatBytes, toHex, fromHex, utf8 } from '../../packages/reploid/src/inference/attested/bytes.js';
import { spkiDigest, parseCertificate } from '../../packages/reploid/src/inference/attested/x509.js';
import { SNP_REPORT_BYTES, SNP_SIGNED_BYTES } from '../../packages/reploid/src/inference/attested/reports.js';
import { ATTESTED_POLICY_SCHEMA } from '../../packages/reploid/src/inference/attested/verifier.js';

const subtle = globalThis.crypto.subtle;
const DAY = 86400000;

// --- DER encoding (test side only) ---
const len = n => n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 0xff] : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff];
export const tlv = (tag, ...parts) => { const value = concatBytes(...parts); return concatBytes(Uint8Array.from([tag, ...len(value.length)]), value); };
const seq = (...parts) => tlv(0x30, ...parts);
const set = (...parts) => tlv(0x31, ...parts);
const ctx = (n, ...parts) => tlv(0xa0 + n, ...parts);
const integer = bytes => tlv(0x02, bytes[0] & 0x80 ? concatBytes(Uint8Array.of(0), bytes) : bytes);
const small = n => integer(Uint8Array.of(n));
const octet = bytes => tlv(0x04, bytes);
const bits = bytes => tlv(0x03, Uint8Array.of(0), bytes);
const nul = () => Uint8Array.of(0x05, 0x00);
const bool = value => Uint8Array.of(0x01, 0x01, value ? 0xff : 0x00);
function oid(text) {
  const [a, b, ...rest] = text.split('.').map(Number);
  const out = [40 * a + b];
  for (const part of rest) {
    const chunk = [part & 0x7f];
    for (let v = Math.floor(part / 128); v > 0; v = Math.floor(v / 128)) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Uint8Array.from(out));
}
const time = ms => {
  const d = new Date(ms), p = n => String(n).padStart(2, '0');
  const body = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  const year = d.getUTCFullYear();
  return year >= 1950 && year < 2050 ? tlv(0x17, utf8(`${String(year).slice(2)}${body}`)) : tlv(0x18, utf8(`${year}${body}`));
};
const generalized = ms => { const d = new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14); return tlv(0x18, utf8(`${d}Z`)); };
const name = cn => seq(set(seq(oid('2.5.4.3'), tlv(0x0c, utf8(cn)))));

const ALG = {
  'ecdsa-SHA-256': () => seq(oid('1.2.840.10045.4.3.2')),
  'ecdsa-SHA-384': () => seq(oid('1.2.840.10045.4.3.3')),
  'rsa-pss-SHA-384': () => seq(oid('1.2.840.113549.1.1.10'), seq(ctx(0, seq(oid('2.16.840.1.101.3.4.2.2'), nul())),
    ctx(1, seq(oid('1.2.840.113549.1.1.8'), seq(oid('2.16.840.1.101.3.4.2.2'), nul()))), ctx(2, small(48))))
};
export function rawToDerSignature(raw) {
  const half = raw.length / 2;
  const trim = b => { let i = 0; while (i < b.length - 1 && b[i] === 0) i += 1; return b.subarray(i); };
  return seq(integer(trim(raw.subarray(0, half))), integer(trim(raw.subarray(half))));
}
async function sign(key, scheme, data) {
  if (scheme.startsWith('rsa-pss')) return new Uint8Array(await subtle.sign({ name: 'RSA-PSS', saltLength: 48 }, key.privateKey, data));
  const raw = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: scheme.slice(6) }, key.privateKey, data));
  return rawToDerSignature(raw);
}
export const signRaw = async (key, hash, data) => new Uint8Array(await subtle.sign({ name: 'ECDSA', hash }, key.privateKey, data));

export const ecKey = curve => subtle.generateKey({ name: 'ECDSA', namedCurve: curve }, true, ['sign', 'verify']);
export const rsaKey = () => subtle.generateKey({ name: 'RSA-PSS', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-384' }, true, ['sign', 'verify']);

let serialCounter = 1;
/** A DER X.509 v3 certificate. `issuer` is { name, key, scheme } or null for self-signed. */
export async function makeCertificate({ cn, key, issuer = null, scheme, notBefore, notAfter, ca = false, ocspSigning = false }) {
  const signer = issuer ?? { name: cn, key, scheme };
  const spki = new Uint8Array(await subtle.exportKey('spki', key.publicKey));
  const extensions = [seq(oid('2.5.29.19'), bool(true), octet(ca ? seq(bool(true)) : seq())),
    seq(oid('2.5.29.15'), bool(true), octet(ca ? Uint8Array.of(0x03, 0x02, 0x01, 0x06) : Uint8Array.of(0x03, 0x02, 0x07, 0x80)))];
  if (ocspSigning) extensions.push(seq(oid('2.5.29.37'), octet(seq(oid('1.3.6.1.5.5.7.3.9')))));
  const tbs = seq(ctx(0, small(2)), small(serialCounter++), ALG[signer.scheme](), name(signer.name), seq(time(notBefore), time(notAfter)),
    name(cn), spki, ctx(3, seq(...extensions)));
  return seq(tbs, ALG[signer.scheme](), bits(await sign(signer.key, signer.scheme, tbs)));
}

/** A DER OCSP response for `certDer` from its issuer (or a delegated responder). */
export async function makeOcspResponse({ certDer, issuerDer, signer, status = 'good', thisUpdate, nextUpdate, includeResponder = null }) {
  const cert = parseCertificate(certDer), issuer = parseCertificate(issuerDer);
  const h = async bytes => new Uint8Array(await subtle.digest('SHA-384', bytes));
  const certId = seq(seq(oid('2.16.840.1.101.3.4.2.2'), nul()), octet(await h(issuer.subject)), octet(await h(issuer.publicKey.keyBits)), integer(cert.serial));
  const certStatus = status === 'good' ? Uint8Array.of(0x80, 0x00) : status === 'revoked' ? ctx(1, generalized(thisUpdate - DAY)) : Uint8Array.of(0x82, 0x00);
  const single = seq(certId, certStatus, generalized(thisUpdate), ...(nextUpdate ? [ctx(0, generalized(nextUpdate))] : []));
  const tbs = seq(ctx(1, name(signer.name)), generalized(thisUpdate), seq(single));
  const basic = seq(tbs, ALG[signer.scheme](), bits(await sign(signer.key, signer.scheme, tbs)), ...(includeResponder ? [ctx(0, seq(includeResponder))] : []));
  return seq(tlv(0x0a, Uint8Array.of(0)), ctx(0, seq(oid('1.3.6.1.5.5.7.48.1.1'), octet(basic))));
}

// --- Hardware reports ---
const writeLe = (target, offset, value, width) => { let v = BigInt(value); for (let i = 0; i < width; i += 1) { target[offset + i] = Number(v & 0xffn); v >>= 8n; } };

export async function makeSnpReport({ reportData, measurement, policy = 0x30000n, vcek, tcb = { bootloader: 9, tee: 0, snp: 23, microcode: 72 } }) {
  const b = new Uint8Array(SNP_REPORT_BYTES);
  writeLe(b, 0x00, 3, 4); writeLe(b, 0x08, policy, 8); writeLe(b, 0x30, 0, 4); writeLe(b, 0x34, 1, 4);
  const tcbValue = BigInt(tcb.bootloader) | (BigInt(tcb.tee) << 8n) | (BigInt(tcb.snp) << 48n) | (BigInt(tcb.microcode) << 56n);
  writeLe(b, 0x38, tcbValue, 8); writeLe(b, 0x180, tcbValue, 8);
  b.set(reportData, 0x50); b.set(fromHex(measurement), 0x90); b.set(globalThis.crypto.getRandomValues(new Uint8Array(64)), 0x1a0);
  const raw = await signRaw(vcek, 'SHA-384', b.subarray(0, SNP_SIGNED_BYTES));
  b.set(raw.slice(0, 48).reverse(), 0x2a0); b.set(raw.slice(48).reverse(), 0x2a0 + 72);
  return b;
}

const pem = der => `-----BEGIN CERTIFICATE-----\n${Buffer.from(der).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;

export async function makeTdxQuote({ reportData, mrTd, rtmr, tdAttributes = 0n, attestationKey, pck, pckChainDer }) {
  const header = new Uint8Array(48);
  writeLe(header, 0, 4, 2); writeLe(header, 2, 2, 2); writeLe(header, 4, 0x81, 4);
  const body = new Uint8Array(584);
  writeLe(body, 120, tdAttributes, 8);
  body.set(fromHex(mrTd), 136);
  rtmr.forEach((value, index) => body.set(fromHex(value), 376 + index * 48));
  body.set(reportData, 520);
  const signed = concatBytes(header, body);
  const signature = await signRaw(attestationKey, 'SHA-256', signed);
  const attKey = new Uint8Array(await subtle.exportKey('raw', attestationKey.publicKey)).subarray(1);
  const qeAuth = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const qeReport = new Uint8Array(384);
  qeReport.set(new Uint8Array(await subtle.digest('SHA-256', concatBytes(attKey, qeAuth))), 320);
  const qeSignature = await signRaw(pck, 'SHA-256', qeReport);
  const chain = utf8(pckChainDer.map(pem).join(''));
  const certData = new Uint8Array(6); writeLe(certData, 0, 5, 2); writeLe(certData, 2, chain.length, 4);
  const authLen = new Uint8Array(2); writeLe(authLen, 0, qeAuth.length, 2);
  const qeBlock = concatBytes(qeReport, qeSignature, authLen, qeAuth, certData, chain);
  const outer = new Uint8Array(6); writeLe(outer, 0, 6, 2); writeLe(outer, 2, qeBlock.length, 4);
  const sigData = concatBytes(signature, attKey, outer, qeBlock);
  const sigLen = new Uint8Array(4); writeLe(sigLen, 0, sigData.length, 4);
  return concatBytes(signed, sigLen, sigData);
}

export async function makeGpuReport({ nonce, measurements, leaf, opaque = { 3: utf8('580.105.08'), 6: utf8('96.00.d9.00.01') } }) {
  const request = concatBytes(Uint8Array.of(0x11, 0xe0, 0x01, 0xff), nonce, Uint8Array.of(0));
  const blocks = Object.entries(measurements).map(([index, value]) => {
    const v = fromHex(value);
    const block = new Uint8Array(7 + v.length);
    block[0] = Number(index); block[1] = 1; writeLe(block, 2, 3 + v.length, 2); block[4] = 1; writeLe(block, 5, v.length, 2); block.set(v, 7);
    return block;
  });
  const record = concatBytes(...blocks);
  const head = Uint8Array.of(0x11, 0x60, 0, 0, blocks.length, record.length & 0xff, (record.length >> 8) & 0xff, record.length >> 16);
  const opaqueBytes = concatBytes(...Object.entries(opaque).map(([type, value]) => {
    const t = new Uint8Array(4); writeLe(t, 0, Number(type), 2); writeLe(t, 2, value.length, 2); return concatBytes(t, value);
  }));
  const opaqueLen = new Uint8Array(2); writeLe(opaqueLen, 0, opaqueBytes.length, 2);
  const signed = concatBytes(request, head, record, globalThis.crypto.getRandomValues(new Uint8Array(32)), opaqueLen, opaqueBytes);
  return concatBytes(signed, await signRaw(leaf, 'SHA-384', signed));
}

// --- A complete synthetic world: roots, chains, a policy and confidential-VM hosts ---
const h48 = seed => toHex(new Uint8Array(48).map((_, i) => (seed * 31 + i * 7) & 0xff));
const h32 = seed => toHex(new Uint8Array(32).map((_, i) => (seed * 17 + i * 3) & 0xff));
export const SYNTHETIC_MODEL = Object.freeze({ id: 'qwen-3-8-27b-text-q4k-ef16-af32', identity: 'sha256:74ea5e226e688388f8e4575d8c795c6132a5f2006046763305c6932321141972' });
export const SYNTHETIC_LAUNCH = Object.freeze({ image: 'sha256:' + '5'.repeat(64),
  runtime: { name: 'reploid-native-doppler', version: '0.1.5', digest: 'sha256:' + '6'.repeat(64) }, model: SYNTHETIC_MODEL });
export const SYNTHETIC_MEASUREMENTS = Object.freeze({ snp: h48(1), mrTd: h48(2), rtmr: [h48(3), h48(4), h48(5), null], gpu: { 2: h48(6), 9: h48(7), 12: h48(8) } });

export async function createSyntheticWorld({ now = Date.UTC(2026, 10, 25, 12), expireGpuLeaf = false } = {}) {
  const valid = { notBefore: now - 30 * DAY, notAfter: now + 365 * DAY };
  // AMD: ARK and ASK sign with RSA-PSS SHA-384, the VCEK is P-384.
  const ark = await rsaKey(), ask = await rsaKey(), vcek = await ecKey('P-384');
  const arkDer = await makeCertificate({ cn: 'Synthetic AMD ARK (test only)', key: ark, scheme: 'rsa-pss-SHA-384', ca: true, ...valid });
  const askDer = await makeCertificate({ cn: 'Synthetic AMD ASK (test only)', key: ask, issuer: { name: 'Synthetic AMD ARK (test only)', key: ark, scheme: 'rsa-pss-SHA-384' }, ca: true, ...valid });
  const vcekDer = await makeCertificate({ cn: 'Synthetic AMD VCEK (test only)', key: vcek, issuer: { name: 'Synthetic AMD ASK (test only)', key: ask, scheme: 'rsa-pss-SHA-384' }, ...valid });
  // Intel: SGX root, platform CA, PCK leaf, all P-256 with SHA-256.
  const sgxRoot = await ecKey('P-256'), platformCa = await ecKey('P-256'), pck = await ecKey('P-256'), qeAttestation = await ecKey('P-256');
  const sgxRootDer = await makeCertificate({ cn: 'Synthetic Intel SGX Root CA (test only)', key: sgxRoot, scheme: 'ecdsa-SHA-256', ca: true, ...valid });
  const platformCaDer = await makeCertificate({ cn: 'Synthetic Intel SGX PCK Platform CA (test only)', key: platformCa, issuer: { name: 'Synthetic Intel SGX Root CA (test only)', key: sgxRoot, scheme: 'ecdsa-SHA-256' }, ca: true, ...valid });
  const pckDer = await makeCertificate({ cn: 'Synthetic Intel SGX PCK Certificate (test only)', key: pck, issuer: { name: 'Synthetic Intel SGX PCK Platform CA (test only)', key: platformCa, scheme: 'ecdsa-SHA-256' }, ...valid });
  // NVIDIA: device root, GPU CA, device identity, attestation leaf, all P-384 with SHA-384.
  const nvRoot = await ecKey('P-384'), nvCa = await ecKey('P-384'), nvDevice = await ecKey('P-384'), nvLeaf = await ecKey('P-384'), nvResponder = await ecKey('P-384');
  const s = (cn, key) => ({ name: cn, key, scheme: 'ecdsa-SHA-384' });
  const nvRootDer = await makeCertificate({ cn: 'Synthetic GPU Device Root CA (test only)', key: nvRoot, scheme: 'ecdsa-SHA-384', ca: true, ...valid });
  const nvCaDer = await makeCertificate({ cn: 'Synthetic GPU Hopper CA (test only)', key: nvCa, issuer: s('Synthetic GPU Device Root CA (test only)', nvRoot), ca: true, ...valid });
  const nvDeviceDer = await makeCertificate({ cn: 'Synthetic GPU Device Identity (test only)', key: nvDevice, issuer: s('Synthetic GPU Hopper CA (test only)', nvCa), ca: true, ...valid });
  const nvLeafDer = await makeCertificate({ cn: 'Synthetic GPU Attestation Key (test only)', key: nvLeaf, issuer: s('Synthetic GPU Device Identity (test only)', nvDevice),
    ...(expireGpuLeaf ? { notBefore: now - 400 * DAY, notAfter: now - DAY } : valid) });
  const nvResponderDer = await makeCertificate({ cn: 'Synthetic GPU OCSP Responder (test only)', key: nvResponder, issuer: s('Synthetic GPU Hopper CA (test only)', nvCa), ocspSigning: true, ...valid });
  const ocspWindow = { thisUpdate: now - 3600000, nextUpdate: now + 7 * DAY };
  const gpuChain = [nvLeafDer, nvDeviceDer, nvCaDer, nvRootDer];
  const ocsp = async (overrides = {}) => [
    await makeOcspResponse({ certDer: nvLeafDer, issuerDer: nvDeviceDer, signer: s('Synthetic GPU Device Identity (test only)', nvDevice), ...ocspWindow, ...overrides.leaf }),
    // The device certificate's status comes from a delegated responder of its issuer, as large CAs do.
    await makeOcspResponse({ certDer: nvDeviceDer, issuerDer: nvCaDer, signer: s('Synthetic GPU OCSP Responder (test only)', nvResponder), includeResponder: nvResponderDer, ...ocspWindow }),
    await makeOcspResponse({ certDer: nvCaDer, issuerDer: nvRootDer, signer: s('Synthetic GPU Device Root CA (test only)', nvRoot), ...ocspWindow })
  ];
  const roots = {
    amdArk: [await spkiDigest(parseCertificate(arkDer))],
    intelSgxRoot: [await spkiDigest(parseCertificate(sgxRootDer))],
    nvidiaDevice: [await spkiDigest(parseCertificate(nvRootDer))]
  };
  const policy = {
    schema: ATTESTED_POLICY_SCHEMA, roots,
    launches: [
      { id: 'synthetic-snp-27b', platform: 'amd-sev-snp', measurement: SYNTHETIC_MEASUREMENTS.snp, launch: structuredClone(SYNTHETIC_LAUNCH), label: 'Synthetic SNP image (test only)', coverage: 'full-image' },
      { id: 'synthetic-tdx-27b', platform: 'intel-tdx', measurement: { mrTd: SYNTHETIC_MEASUREMENTS.mrTd, rtmr: [...SYNTHETIC_MEASUREMENTS.rtmr] },
        launch: structuredClone(SYNTHETIC_LAUNCH), label: 'Synthetic TDX image (test only)', coverage: 'boot-chain-only' }
    ],
    gpu: { measurementSets: [{ label: 'Synthetic H100 driver and VBIOS reference (test only)', measurements: { ...SYNTHETIC_MEASUREMENTS.gpu } }], minCount: 1, maxCount: 1 },
    revocation: { gpuOcsp: 'required', maxOcspAgeMs: 2 * DAY, cpu: 'not-checked' },
    tdxCollateral: 'not-checked',
    clockSkewMs: 60000, maxEvidenceAgeMs: 120000, maxSessionMs: 15 * 60000, maxCreditsPerOutputToken: 4
  };
  return { now, policy, keys: { vcek, pck, qeAttestation, nvLeaf }, chains: { amd: [vcekDer, askDer, arkDer], intelPck: [pckDer, platformCaDer, sgxRootDer], gpu: gpuChain },
    ocsp, h32 };
}

/**
 * A synthetic confidential-VM host for serveAttestedSession. `faults` change one thing at a time:
 *   ccMode, devToolsMode, snpDebug, tdxDebug, measurement, gpuMeasurements, unboundKey, wrongNonce, badGpuSignature,
 *   revokedLeaf, staleOcsp, model, answer, failRuntime
 */
export function syntheticHost(world, { platform = 'amd-sev-snp', faults = {}, participantId = 'peer:attested-synthetic', record = {} } = {}) {
  const launch = structuredClone(SYNTHETIC_LAUNCH);
  if (faults.model) launch.model = faults.model;
  return {
    participantId, platform, launch,
    async collectGpuEvidence(nonce) {
      record.gpuNonce = nonce;
      const report = await makeGpuReport({ nonce, measurements: faults.gpuMeasurements ?? SYNTHETIC_MEASUREMENTS.gpu, leaf: world.keys.nvLeaf });
      if (faults.badGpuSignature) report[report.length - 5] ^= 0xff;
      const ocsp = await world.ocsp(faults.revokedLeaf ? { leaf: { status: 'revoked' } } : faults.staleOcsp ? { leaf: { thisUpdate: world.now - 10 * DAY, nextUpdate: null } } : {});
      return [{ index: 0, architecture: 'hopper', ccMode: faults.ccMode ?? 'on', devToolsMode: faults.devToolsMode ?? false, report, certificates: world.chains.gpu, ocsp }];
    },
    async collectCpuEvidence(reportData) {
      record.reportData = reportData;
      const data = faults.unboundKey ? globalThis.crypto.getRandomValues(new Uint8Array(64)) : reportData;
      if (platform === 'amd-sev-snp') {
        return { report: await makeSnpReport({ reportData: data, measurement: faults.measurement ?? SYNTHETIC_MEASUREMENTS.snp, vcek: world.keys.vcek,
          policy: faults.snpDebug ? 0x30000n | (1n << 19n) : 0x30000n }), certificates: world.chains.amd };
      }
      return { report: await makeTdxQuote({ reportData: data, mrTd: faults.measurement ?? SYNTHETIC_MEASUREMENTS.mrTd,
        rtmr: [SYNTHETIC_MEASUREMENTS.rtmr[0], SYNTHETIC_MEASUREMENTS.rtmr[1], SYNTHETIC_MEASUREMENTS.rtmr[2], h48(9)],
        tdAttributes: faults.tdxDebug ? 1n : 0n, attestationKey: world.keys.qeAttestation, pck: world.keys.pck, pckChainDer: world.chains.intelPck }), certificates: [] };
    },
    async generate({ messages, onDelta }) {
      record.messages = structuredClone(messages);
      if (faults.failRuntime) throw Object.assign(new Error('runtime down'), { code: 'RUNTIME_DOWN' });
      const answer = faults.answer ?? 'Diagnosis: the build fails because src/config.ts imports a missing export.';
      for (const word of answer.match(/\S+\s*/g)) onDelta(word);
      return { text: answer, finishReason: 'stop', stopReason: 'eos-token', usage: { inputTokens: 812, outputTokens: answer.split(/\s+/).length } };
    }
  };
}
