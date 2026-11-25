/**
 * Parsers and signature checks for the three hardware reports of the attested GPU route:
 *
 * - AMD SEV-SNP ATTESTATION_REPORT (SEV-SNP ABI 1.55, table 22): 1184 bytes, ECDSA P-384 / SHA-384 by the VCEK,
 *   signature r and s little-endian at 0x2A0.
 * - Intel TDX quote v4 (DCAP quote format): 48-byte header, 584-byte TD report body, ECDSA P-256 quote signature
 *   by the QE attestation key, QE report (a 384-byte SGX report body) signed by the PCK key, PCK chain as PEM in
 *   certification data type 5.
 * - NVIDIA GPU attestation report: an SPDM 1.1 GET_MEASUREMENTS request (with the 32-byte requester nonce) followed
 *   by its MEASUREMENTS response, signed with ECDSA P-384 / SHA-384 over request || response-without-signature
 *   by the GPU's attestation key (the leaf of its device certificate chain).
 *
 * Parsers throw `{ code: 'REPORT_MALFORMED' }`. Nothing here decides policy; `verifier.js` does.
 */
import { concatBytes, toHex, digest, equalBytes } from './bytes.js';
import { base64ToBytes } from '../../artifacts/binary.js';
import { parseCertificate, verifyEcdsaRaw, verifySignature } from './x509.js';

const malformed = message => Object.assign(new Error(`Malformed report: ${message}`), { code: 'REPORT_MALFORMED' });
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b, o) => BigInt(u32(b, o)) | (BigInt(u32(b, o + 4)) << 32n);
const hex = (b, o, n) => toHex(b.subarray(o, o + n));

export const SNP_REPORT_BYTES = 1184;
export const SNP_SIGNED_BYTES = 0x2a0;
/** Guest policy bit 19: DEBUG. A debuggable guest's memory is readable by the hypervisor. */
export const SNP_POLICY_DEBUG = 1n << 19n;
export const SNP_POLICY_MIGRATE_MA = 1n << 18n;

const tcb = value => ({ bootloader: Number(value & 0xffn), tee: Number((value >> 8n) & 0xffn),
  snp: Number((value >> 48n) & 0xffn), microcode: Number((value >> 56n) & 0xffn) });

export function parseSnpReport(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== SNP_REPORT_BYTES) throw malformed('an SEV-SNP report is 1184 bytes');
  const version = u32(bytes, 0x00);
  if (version < 2 || version > 5) throw malformed(`unsupported SEV-SNP report version ${version}`);
  if (u32(bytes, 0x34) !== 1) throw malformed('SEV-SNP signature algorithm is not ECDSA P-384 with SHA-384');
  const policy = u64(bytes, 0x08);
  const le = (offset) => bytes.slice(offset, offset + 48).reverse();
  return {
    platform: 'amd-sev-snp', version, guestSvn: u32(bytes, 0x04), policy, debug: (policy & SNP_POLICY_DEBUG) !== 0n,
    migrationAgent: (policy & SNP_POLICY_MIGRATE_MA) !== 0n, vmpl: u32(bytes, 0x30),
    currentTcb: tcb(u64(bytes, 0x38)), reportedTcb: tcb(u64(bytes, 0x180)), platformInfo: u64(bytes, 0x40),
    reportData: bytes.slice(0x50, 0x90), measurement: hex(bytes, 0x90, 48), hostData: hex(bytes, 0xc0, 32),
    idKeyDigest: hex(bytes, 0xe0, 48), reportId: hex(bytes, 0x140, 32), chipId: hex(bytes, 0x1a0, 64),
    signed: bytes.slice(0, SNP_SIGNED_BYTES),
    // r and s are 72-byte little-endian fields; P-384 uses the low 48 bytes of each.
    signature: concatBytes(le(0x2a0), le(0x2a0 + 72))
  };
}

/** Verify an SNP report signature with the VCEK (P-384 leaf of the ARK > ASK > VCEK chain). */
export const verifySnpReportSignature = (report, vcek) => verifyEcdsaRaw(vcek, report.signature, report.signed, 'SHA-384');

export const TDX_HEADER_BYTES = 48;
export const TDX_BODY_BYTES = 584;
/** TD_ATTRIBUTES bit 0: DEBUG (TUD.DEBUG). A debuggable TD's state is readable by the host VMM. */
export const TDX_ATTRIBUTE_DEBUG = 1n;

const pemToDer = pem => {
  const blocks = [...pem.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)];
  return blocks.map(([, body]) => base64ToBytes(body.replace(/\s+/g, '')));
};

export function parseTdxQuote(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < TDX_HEADER_BYTES + TDX_BODY_BYTES + 4) throw malformed('a TDX quote is too short');
  const version = u16(bytes, 0), keyType = u16(bytes, 2), teeType = u32(bytes, 4);
  if (version !== 4) throw malformed(`unsupported quote version ${version}`);
  if (keyType !== 2) throw malformed('the quote attestation key is not ECDSA P-256');
  if (teeType !== 0x81) throw malformed('not a TDX quote');
  const b = TDX_HEADER_BYTES;
  const tdAttributes = u64(bytes, b + 120);
  // RTMR0 to RTMR3 follow MROWNERCONFIG (which ends at 328); REPORTDATA starts at 520.
  const rtmr = index => hex(bytes, b + 328 + index * 48, 48);
  const body = {
    teeTcbSvn: hex(bytes, b, 16), mrSeam: hex(bytes, b + 16, 48), mrSignerSeam: hex(bytes, b + 64, 48),
    seamAttributes: hex(bytes, b + 112, 8), tdAttributes, xfam: hex(bytes, b + 128, 8), mrTd: hex(bytes, b + 136, 48),
    mrConfigId: hex(bytes, b + 184, 48), mrOwner: hex(bytes, b + 232, 48), mrOwnerConfig: hex(bytes, b + 280, 48),
    rtmr: [rtmr(0), rtmr(1), rtmr(2), rtmr(3)], reportData: bytes.slice(b + 520, b + 584)
  };
  let o = b + TDX_BODY_BYTES;
  const signatureLength = u32(bytes, o); o += 4;
  if (o + signatureLength !== bytes.length || signatureLength < 128 + 6) throw malformed('quote signature data length');
  const signature = bytes.slice(o, o + 64), attestationKey = bytes.slice(o + 64, o + 128); o += 128;
  const certType = u16(bytes, o), certSize = u32(bytes, o + 2); o += 6;
  if (certType !== 6 || o + certSize > bytes.length) throw malformed('expected QE report certification data (type 6)');
  const qeReport = bytes.slice(o, o + 384), qeReportSignature = bytes.slice(o + 384, o + 448); o += 448;
  if (qeReport.length !== 384 || qeReportSignature.length !== 64) throw malformed('truncated QE report');
  const authSize = u16(bytes, o); const qeAuthData = bytes.slice(o + 2, o + 2 + authSize); o += 2 + authSize;
  const innerType = u16(bytes, o), innerSize = u32(bytes, o + 2); o += 6;
  if (innerType !== 5 || o + innerSize > bytes.length) throw malformed('expected a PCK certificate chain (type 5)');
  const pckChain = pemToDer(new TextDecoder().decode(bytes.subarray(o, o + innerSize)).replace(/\0+$/, ''));
  if (!pckChain.length) throw malformed('empty PCK certificate chain');
  return {
    platform: 'intel-tdx', version, ...body, debug: (tdAttributes & TDX_ATTRIBUTE_DEBUG) !== 0n,
    signed: bytes.slice(0, b + TDX_BODY_BYTES), signature, attestationKey, qeReport, qeReportSignature, qeAuthData, pckChain,
    // The quoting enclave's identity, from its SGX report body: ATTRIBUTES.flags at 48 (bit 1 is DEBUG), MRSIGNER at 128,
    // ISVPRODID at 256 and ISVSVN at 258. It means something only after verifyTdxQuoteSignatures has passed.
    qe: { debug: (u64(qeReport, 48) & 2n) !== 0n, mrSigner: hex(qeReport, 128, 32), isvProdId: u16(qeReport, 256), isvSvn: u16(qeReport, 258) }
  };
}

/**
 * The quote's own signature chain: PCK leaf signs the QE report; the QE report binds the attestation key
 * (report data = SHA-256(attestation key || QE auth data) || 32 zero bytes); the attestation key signs the quote.
 * This proves only that some enclave the platform's PCK certified made the quote. The verifier checks the PCK chain
 * and that the enclave is the pinned quoting enclave; TCB status is left to its collateral hook.
 */
export async function verifyTdxQuoteSignatures(quote) {
  const pck = parseCertificate(quote.pckChain[0]);
  if (!await verifyEcdsaRaw(pck, quote.qeReportSignature, quote.qeReport, 'SHA-256')) return false;
  const expected = concatBytes(await digest('SHA-256', concatBytes(quote.attestationKey, quote.qeAuthData)), new Uint8Array(32));
  if (!equalBytes(quote.qeReport.slice(320, 384), expected)) return false;
  const spki = concatBytes(Uint8Array.from([0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00, 0x04]), quote.attestationKey);
  try {
    const key = await globalThis.crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await globalThis.crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, quote.signature, quote.signed);
  } catch { return false; }
}

export const SPDM_GET_MEASUREMENTS = 0xe0;
export const SPDM_MEASUREMENTS = 0x60;
export const SPDM_REQUEST_BYTES = 37;
export const GPU_SIGNATURE_BYTES = 96;

/** Parse an NVIDIA GPU attestation report: SPDM GET_MEASUREMENTS request || MEASUREMENTS response. */
export function parseGpuReport(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < SPDM_REQUEST_BYTES + 8 + 32 + 2 + GPU_SIGNATURE_BYTES) throw malformed('GPU report too short');
  const request = bytes.subarray(0, SPDM_REQUEST_BYTES);
  if (request[1] !== SPDM_GET_MEASUREMENTS || !(request[2] & 1)) throw malformed('expected a signed GET_MEASUREMENTS request');
  const response = bytes.subarray(SPDM_REQUEST_BYTES);
  if (response[0] !== request[0] || response[1] !== SPDM_MEASUREMENTS) throw malformed('expected a MEASUREMENTS response of the same SPDM version');
  const blockCount = response[4];
  const recordLength = response[5] | (response[6] << 8) | (response[7] << 16);
  let o = 8;
  const end = o + recordLength;
  if (end + 32 + 2 + GPU_SIGNATURE_BYTES > response.length) throw malformed('measurement record overruns the report');
  const measurements = {};
  while (o < end) {
    const index = response[o], size = u16(response, o + 2);
    const valueSize = u16(response, o + 5);
    if (o + 4 + size > end || valueSize + 3 !== size) throw malformed('measurement block');
    if (Object.hasOwn(measurements, index)) throw malformed(`duplicate measurement index ${index}`);
    measurements[index] = hex(response, o + 7, valueSize);
    o += 4 + size;
  }
  if (Object.keys(measurements).length !== blockCount) throw malformed('measurement block count');
  const responderNonce = response.slice(o, o + 32); o += 32;
  const opaqueLength = u16(response, o); o += 2;
  const opaque = response.subarray(o, o + opaqueLength); o += opaqueLength;
  if (o + GPU_SIGNATURE_BYTES !== response.length) throw malformed('signature position');
  const opaqueFields = {};
  for (let p = 0; p + 4 <= opaque.length;) {
    const type = u16(opaque, p), size = u16(opaque, p + 2);
    if (p + 4 + size > opaque.length) throw malformed('opaque field');
    opaqueFields[type] = hex(opaque, p + 4, size);
    p += 4 + size;
  }
  return {
    spdmVersion: request[0], requesterNonce: request.slice(4, 36), responderNonce, measurements, opaqueFields,
    signed: bytes.slice(0, bytes.length - GPU_SIGNATURE_BYTES), signature: bytes.slice(bytes.length - GPU_SIGNATURE_BYTES)
  };
}

/** Verify a GPU report signature with the GPU attestation leaf certificate (P-384). */
export const verifyGpuReportSignature = (report, leaf) => verifyEcdsaRaw(leaf, report.signature, report.signed, 'SHA-384');
export { verifySignature };
