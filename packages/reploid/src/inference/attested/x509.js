/**
 * Minimal DER, X.509 and OCSP reading for attestation certificate chains, with ECDSA verification over Web Crypto.
 * It reads what chain validation needs (names, validity, keys, basic constraints, key usage, extended key usage)
 * and refuses anything it cannot parse. It runs the same in a browser and in Node.
 *
 * Covers ECDSA P-256 and P-384 with SHA-256, SHA-384 or SHA-512 (Intel PCK and NVIDIA device chains, AMD VCEK
 * keys) and RSASSA-PSS (AMD's ARK and ASK sign with RSA-PSS SHA-384).
 */
import { concatBytes, equalBytes, toHex, digest } from './bytes.js';

export class DerError extends Error {}
const fail = message => { throw new DerError(message); };

/** One TLV at `offset`: { tag, start, header, length, end, value } (value is a view, not a copy). */
export function readTlv(bytes, offset = 0) {
  if (offset + 2 > bytes.length) fail('DER: truncated header');
  const tag = bytes[offset];
  if ((tag & 0x1f) === 0x1f) fail('DER: multi-byte tags are not supported');
  let length = bytes[offset + 1], header = 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4) fail('DER: unsupported length');
    if (offset + 2 + count > bytes.length) fail('DER: truncated length');
    length = 0;
    for (let i = 0; i < count; i += 1) length = length * 256 + bytes[offset + 2 + i];
    if (length < 0x80 || (count > 1 && bytes[offset + 2] === 0)) fail('DER: non-minimal length');
    header += count;
  }
  const end = offset + header + length;
  if (end > bytes.length) fail('DER: truncated value');
  return { tag, start: offset, header, length, end, value: bytes.subarray(offset + header, end), raw: bytes.subarray(offset, end) };
}

/** The children of a constructed TLV. */
export function children(tlv) {
  if (!(tlv.tag & 0x20)) fail('DER: expected a constructed value');
  const out = [];
  for (let offset = 0; offset < tlv.value.length;) {
    const child = readTlv(tlv.value, offset);
    out.push(child);
    offset = child.end;
  }
  return out;
}

const expectTag = (tlv, tag, what) => { if (tlv?.tag !== tag) fail(`DER: expected ${what}`); return tlv; };

export function decodeOid(value) {
  const parts = [];
  let current = 0;
  for (let i = 0; i < value.length; i += 1) {
    current = current * 128 + (value[i] & 0x7f);
    if (!(value[i] & 0x80)) { parts.push(current); current = 0; }
  }
  if (!parts.length) fail('DER: empty OID');
  const first = parts.shift();
  return [first < 80 ? Math.floor(first / 40) : 2, first < 80 ? first % 40 : first - 80, ...parts].join('.');
}

function decodeTime(tlv) {
  const text = new TextDecoder().decode(tlv.value);
  const match = tlv.tag === 0x17 ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text)
    : tlv.tag === 0x18 ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text) : null;
  if (!match) fail('DER: unsupported time');
  let year = Number(match[1]);
  if (tlv.tag === 0x17) year += year < 50 ? 2000 : 1900;
  return Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
}

const OID = Object.freeze({
  ecPublicKey: '1.2.840.10045.2.1', p256: '1.2.840.10045.3.1.7', p384: '1.3.132.0.34',
  ecdsaSha256: '1.2.840.10045.4.3.2', ecdsaSha384: '1.2.840.10045.4.3.3', ecdsaSha512: '1.2.840.10045.4.3.4',
  rsaPss: '1.2.840.113549.1.1.10', rsaEncryption: '1.2.840.113549.1.1.1',
  basicConstraints: '2.5.29.19', keyUsage: '2.5.29.15', extKeyUsage: '2.5.29.37', ocspSigning: '1.3.6.1.5.5.7.3.9',
  commonName: '2.5.4.3', sha1: '1.3.14.3.2.26', sha256: '2.16.840.1.101.3.4.2.1', sha384: '2.16.840.1.101.3.4.2.2',
  ocspBasic: '1.3.6.1.5.5.7.48.1.1'
});
export { OID as X509_OIDS };
const SIGNATURE_HASH = { [OID.ecdsaSha256]: 'SHA-256', [OID.ecdsaSha384]: 'SHA-384', [OID.ecdsaSha512]: 'SHA-512' };
const HASH_OIDS = { [OID.sha256]: 'SHA-256', [OID.sha384]: 'SHA-384', '2.16.840.1.101.3.4.2.3': 'SHA-512' };
const CURVES = { [OID.p256]: { name: 'P-256', size: 32 }, [OID.p384]: { name: 'P-384', size: 48 } };
const DIGESTS = { [OID.sha1]: 'SHA-1', [OID.sha256]: 'SHA-256', [OID.sha384]: 'SHA-384' };

function algorithm(tlv) {
  const [oid, params] = children(expectTag(tlv, 0x30, 'an algorithm identifier'));
  return { oid: decodeOid(expectTag(oid, 0x06, 'an OID').value), params: params ?? null };
}

/** How a signature algorithm identifier verifies: ECDSA with a hash, or RSASSA-PSS with its hash and salt. */
function signatureScheme({ oid, params }) {
  if (SIGNATURE_HASH[oid]) return { kind: 'ecdsa', hash: SIGNATURE_HASH[oid] };
  if (oid !== OID.rsaPss || params?.tag !== 0x30) return null;
  let hash = 'SHA-1', saltLength = 20;
  for (const field of children(params)) {
    if (field.tag === 0xa0) hash = HASH_OIDS[algorithm(children(field)[0]).oid] ?? null;
    if (field.tag === 0xa2) saltLength = children(field)[0].value.reduce((value, byte) => value * 256 + byte, 0);
  }
  return hash && hash !== 'SHA-1' ? { kind: 'rsa-pss', hash, saltLength } : null;
}

const derLength = length => length < 0x80 ? Uint8Array.of(length)
  : length < 0x100 ? Uint8Array.of(0x81, length) : length < 0x10000 ? Uint8Array.of(0x82, length >> 8, length & 0xff)
    : Uint8Array.of(0x83, length >> 16, (length >> 8) & 0xff, length & 0xff);
const derTlv = (tag, value) => concatBytes(Uint8Array.of(tag), derLength(value.length), value);
// Browsers import RSA keys only under rsaEncryption; an id-RSASSA-PSS key has the same RSAPublicKey bits.
const RSA_ENCRYPTION_ALGORITHM = Uint8Array.of(0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00);
const rsaSpki = keyBits => derTlv(0x30, concatBytes(RSA_ENCRYPTION_ALGORITHM, derTlv(0x03, concatBytes(Uint8Array.of(0), keyBits))));

function commonName(nameTlv) {
  for (const rdn of children(nameTlv)) for (const attribute of children(rdn)) {
    const [type, value] = children(attribute);
    if (decodeOid(type.value) === OID.commonName) return new TextDecoder().decode(value.value);
  }
  return null;
}

function bitString(tlv) {
  expectTag(tlv, 0x03, 'a bit string');
  if (tlv.value[0] !== 0) fail('DER: unused bits in a key or signature');
  return tlv.value.subarray(1);
}

function publicKeyInfo(tlv) {
  const [alg, key] = children(expectTag(tlv, 0x30, 'a public key'));
  const { oid, params } = algorithm(alg);
  const curve = oid === OID.ecPublicKey && params?.tag === 0x06 ? CURVES[decodeOid(params.value)] ?? null : null;
  return { algorithm: oid, curve, spki: tlv.raw.slice(), keyBits: bitString(key).slice() };
}

/** Parse one DER certificate. Throws DerError on anything malformed. */
export function parseCertificate(der) {
  const bytes = der instanceof Uint8Array ? der : new Uint8Array(der);
  const root = readTlv(bytes);
  if (root.end !== bytes.length) fail('DER: trailing bytes after the certificate');
  const [tbs, sigAlg, signature] = children(expectTag(root, 0x30, 'a certificate'));
  const fields = children(expectTag(tbs, 0x30, 'a TBS certificate'));
  let index = 0;
  if (fields[0]?.tag === 0xa0) index += 1;
  const serial = expectTag(fields[index++], 0x02, 'a serial number').value.slice();
  const innerAlg = algorithm(fields[index++]);
  const issuer = expectTag(fields[index++], 0x30, 'an issuer');
  const [notBefore, notAfter] = children(expectTag(fields[index++], 0x30, 'a validity'));
  const subject = expectTag(fields[index++], 0x30, 'a subject');
  const key = publicKeyInfo(fields[index++]);
  let ca = false, pathLength = null, keyUsage = null, extKeyUsage = [];
  const extensions = fields.slice(index).find(field => field.tag === 0xa3);
  if (extensions) {
    for (const extension of children(children(extensions)[0])) {
      const parts = children(extension);
      const id = decodeOid(parts[0].value);
      const value = readTlv(parts[parts.length - 1].value);
      if (id === OID.basicConstraints) {
        const items = children(value);
        ca = items[0]?.tag === 0x01 && items[0].value[0] !== 0;
        if (items.find(item => item.tag === 0x02)) pathLength = items.find(item => item.tag === 0x02).value[0];
      } else if (id === OID.keyUsage) {
        expectTag(value, 0x03, 'a key usage bit string');
        keyUsage = value.value[1] ?? 0;
      } else if (id === OID.extKeyUsage) {
        extKeyUsage = children(value).map(item => decodeOid(item.value));
      }
    }
  }
  const outer = algorithm(sigAlg);
  if (outer.oid !== innerAlg.oid) fail('X.509: inner and outer signature algorithms differ');
  return {
    der: bytes.slice(), tbs: tbs.raw.slice(), serial, serialHex: toHex(serial), signatureAlgorithm: outer.oid, signatureScheme: signatureScheme(outer),
    signature: bitString(signature).slice(), issuer: issuer.raw.slice(), subject: subject.raw.slice(),
    issuerName: commonName(issuer), subjectName: commonName(subject),
    notBefore: decodeTime(notBefore), notAfter: decodeTime(notAfter), publicKey: key, ca, pathLength, keyUsage, extKeyUsage
  };
}

/** DER ECDSA-Sig-Value to the fixed-size r || s that Web Crypto verifies. */
export function ecdsaDerToRaw(der, size) {
  const [r, s] = children(expectTag(readTlv(der), 0x30, 'an ECDSA signature'));
  const fixed = integer => {
    let value = expectTag(integer, 0x02, 'an integer').value;
    while (value.length > size && value[0] === 0) value = value.subarray(1);
    if (value.length > size) fail('ECDSA: integer too large');
    return concatBytes(new Uint8Array(size - value.length), value);
  };
  return concatBytes(fixed(r), fixed(s));
}

/** Import a certificate's EC public key for ECDSA verification. */
export async function importCertificateKey(certificate) {
  const { curve, algorithm: alg, spki } = certificate.publicKey;
  if (alg !== OID.ecPublicKey || !curve) throw new DerError('X.509: only P-256 and P-384 EC keys are supported');
  return { key: await globalThis.crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: curve.name }, false, ['verify']), curve };
}

/** Verify a signature made with `scheme` (ECDSA in DER, or RSASSA-PSS) by an issuer certificate over `data`. */
export async function verifySignature(issuer, scheme, signature, data) {
  if (!scheme) return false;
  try {
    if (scheme.kind === 'rsa-pss') {
      if (![OID.rsaEncryption, OID.rsaPss].includes(issuer.publicKey.algorithm)) return false;
      const key = await globalThis.crypto.subtle.importKey('spki', rsaSpki(issuer.publicKey.keyBits), { name: 'RSA-PSS', hash: scheme.hash }, false, ['verify']);
      return await globalThis.crypto.subtle.verify({ name: 'RSA-PSS', saltLength: scheme.saltLength }, key, signature, data);
    }
    const { key, curve } = await importCertificateKey(issuer);
    return await globalThis.crypto.subtle.verify({ name: 'ECDSA', hash: scheme.hash }, key, ecdsaDerToRaw(signature, curve.size), data);
  } catch { return false; }
}

/** Verify a DER ECDSA signature by an issuer certificate over `data` with the named hash. */
export const verifyEcdsa = (issuer, signatureDer, data, hash) => verifySignature(issuer, { kind: 'ecdsa', hash }, signatureDer, data);

/** Verify a raw (r || s) ECDSA signature, as attestation reports carry it. */
export async function verifyEcdsaRaw(issuer, rawSignature, data, hash) {
  try {
    const { key } = await importCertificateKey(issuer);
    return await globalThis.crypto.subtle.verify({ name: 'ECDSA', hash }, key, rawSignature, data);
  } catch { return false; }
}

/** `sha256:<hex>` of a certificate's SubjectPublicKeyInfo: how roots are pinned. */
export const spkiDigest = async certificate => `sha256:${toHex(await digest('SHA-256', certificate.publicKey.spki))}`;

/**
 * Validate a chain, leaf first, ending at (or signed by) a pinned root. `roots` are pinned SubjectPublicKeyInfo
 * digests. Every certificate must be within its validity at `now`; every issuer must be a CA. Returns the parsed
 * chain; throws `{ code: 'CERTIFICATE_*' }` errors.
 */
export async function verifyCertificateChain(chainDer, { roots, now }) {
  const refuse = (code, message) => { throw Object.assign(new Error(message), { code }); };
  if (!Array.isArray(chainDer) || !chainDer.length || chainDer.length > 8) refuse('CERTIFICATE_CHAIN_INVALID', 'A chain has 1 to 8 certificates');
  if (!Array.isArray(roots) || !roots.length) refuse('CERTIFICATE_ROOT_UNPINNED', 'No root is pinned for this chain');
  let chain;
  try { chain = chainDer.map(parseCertificate); } catch (error) { refuse('CERTIFICATE_CHAIN_INVALID', `Unparseable certificate: ${error.message}`); }
  for (const certificate of chain) {
    if (!(now >= certificate.notBefore && now <= certificate.notAfter)) {
      refuse('CERTIFICATE_EXPIRED', `Certificate ${certificate.subjectName ?? certificate.serialHex} is outside its validity period`);
    }
  }
  for (let i = 0; i < chain.length - 1; i += 1) {
    const [child, parent] = [chain[i], chain[i + 1]];
    if (!child.signatureScheme) refuse('CERTIFICATE_CHAIN_INVALID', 'Unsupported certificate signature algorithm');
    if (!equalBytes(child.issuer, parent.subject) || !parent.ca || (parent.keyUsage !== null && !(parent.keyUsage & 0x04))) {
      refuse('CERTIFICATE_CHAIN_INVALID', `Certificate ${parent.subjectName} did not issue ${child.subjectName}`);
    }
    if (parent.pathLength !== null && parent.pathLength < i) refuse('CERTIFICATE_CHAIN_INVALID', 'Path length constraint exceeded');
    if (!await verifySignature(parent, child.signatureScheme, child.signature, child.tbs)) refuse('CERTIFICATE_SIGNATURE_INVALID', `Bad signature on ${child.subjectName}`);
  }
  const top = chain[chain.length - 1];
  if (!roots.includes(await spkiDigest(top))) refuse('CERTIFICATE_ROOT_UNPINNED', `Chain ends at ${top.subjectName}, which is not a pinned root`);
  if (!equalBytes(top.issuer, top.subject) || !await verifySignature(top, top.signatureScheme, top.signature, top.tbs)) {
    refuse('CERTIFICATE_SIGNATURE_INVALID', 'The pinned root is not self-signed');
  }
  return chain;
}

const CERT_STATUS = { 0x80: 'good', 0xa1: 'revoked', 0x82: 'unknown' };

/**
 * Check a stapled DER OCSP response for `certificate`, issued by `issuer`. The response must be signed by the
 * issuer or by a responder certificate the issuer signed for OCSP signing, cover this serial, say `good`, and be
 * current: thisUpdate no older than `maxAgeMs` and nextUpdate (when present) not passed.
 */
export async function verifyOcspResponse(responseDer, { certificate, issuer, now, maxAgeMs }) {
  const refuse = (code, message) => { throw Object.assign(new Error(message), { code }); };
  let parsed;
  try {
    const [status, bytes] = children(expectTag(readTlv(responseDer), 0x30, 'an OCSP response'));
    if (status.tag !== 0x0a || status.value[0] !== 0) refuse('OCSP_UNAVAILABLE', 'The OCSP responder did not answer successfully');
    const [type, inner] = children(children(expectTag(bytes, 0xa0, 'response bytes'))[0]);
    if (decodeOid(type.value) !== OID.ocspBasic) fail('OCSP: not a basic response');
    const [tbs, sigAlg, signature, certsField] = children(readTlv(inner.value));
    const tbsFields = children(tbs).filter(field => field.tag !== 0xa0);
    const [, , responses] = tbsFields;
    const singles = children(responses).map(single => {
      const [certId, certStatus, thisUpdate, nextUpdate] = children(single);
      const [hashAlg, nameHash, keyHash, serial] = children(certId);
      return { hash: DIGESTS[algorithm(hashAlg).oid] ?? null, nameHash: nameHash.value, keyHash: keyHash.value, serial: serial.value,
        status: CERT_STATUS[certStatus.tag] ?? 'unknown', thisUpdate: decodeTime(thisUpdate),
        nextUpdate: nextUpdate?.tag === 0xa0 ? decodeTime(children(nextUpdate)[0]) : null };
    });
    const responders = certsField ? children(children(certsField)[0]).map(item => parseCertificate(item.raw)) : [];
    parsed = { tbs: tbs.raw, scheme: signatureScheme(algorithm(sigAlg)), signature: bitString(signature), singles, responders };
  } catch (error) {
    if (error.code) throw error;
    refuse('OCSP_INVALID', `Unparseable OCSP response: ${error.message}`);
  }
  if (!parsed.scheme) refuse('OCSP_INVALID', 'Unsupported OCSP signature algorithm');
  let signer = issuer;
  if (!await verifySignature(issuer, parsed.scheme, parsed.signature, parsed.tbs)) {
    signer = null;
    for (const responder of parsed.responders) {
      const delegated = equalBytes(responder.issuer, issuer.subject) && responder.extKeyUsage.includes(OID.ocspSigning)
        && now >= responder.notBefore && now <= responder.notAfter
        && await verifySignature(issuer, responder.signatureScheme, responder.signature, responder.tbs);
      if (delegated && await verifySignature(responder, parsed.scheme, parsed.signature, parsed.tbs)) { signer = responder; break; }
    }
  }
  if (!signer) refuse('OCSP_SIGNATURE_INVALID', 'The OCSP response is not signed by the issuer or its responder');
  let matched = null;
  for (const single of parsed.singles) {
    if (!single.hash || !equalBytes(single.serial, certificate.serial)) continue;
    const nameHash = await digest(single.hash, issuer.subject);
    const keyHash = await digest(single.hash, issuer.publicKey.keyBits);
    if (equalBytes(nameHash, single.nameHash) && equalBytes(keyHash, single.keyHash)) { matched = single; break; }
  }
  if (!matched) refuse('OCSP_INVALID', `The OCSP response does not cover ${certificate.subjectName}`);
  if (matched.status === 'revoked') refuse('CERTIFICATE_REVOKED', `${certificate.subjectName} is revoked`);
  if (matched.status !== 'good') refuse('OCSP_UNAVAILABLE', `OCSP status of ${certificate.subjectName} is unknown`);
  if (matched.thisUpdate > now || now - matched.thisUpdate > maxAgeMs || (matched.nextUpdate !== null && now > matched.nextUpdate)) {
    refuse('OCSP_STALE', `The OCSP response for ${certificate.subjectName} is not current`);
  }
  return { status: 'good', thisUpdate: matched.thisUpdate, nextUpdate: matched.nextUpdate };
}
