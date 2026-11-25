/**
 * Evidence collectors for a Linux confidential VM: what an attested GPU executor host must expose.
 *
 *   collectCpuEvidence(reportData64) -> { report, certificates }   configfs-tsm (Linux 6.7+): SEV-SNP report or TDX quote
 *   collectGpuEvidence(nonce32)      -> [{ index, architecture, ccMode, devToolsMode, report, certificates, ocsp }]
 *                                       NVML through gpu-evidence.py, with OCSP responses fetched and stapled here
 *
 * Stapling is safe: the requester verifies every OCSP response's signature and freshness itself. Fetching VCEK
 * certificates from AMD's key distribution service is likewise safe; the requester validates the chain to its pinned ARK.
 * UNEXERCISED ON REAL HARDWARE until the first pilot; the synthetic tests cover the formats, not these system calls.
 */
import { mkdir, rmdir, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCertificate } from '../../shared/vendor/reploid/inference/attested/x509.js';
import { parseSnpReport } from '../../shared/vendor/reploid/inference/attested/reports.js';

const TSM_ROOT = '/sys/kernel/config/tsm/report';
const here = path.dirname(fileURLToPath(import.meta.url));

/** One configfs-tsm report: write inblob, read outblob (and auxblob), checking the generation did not move. */
export async function tsmReport(reportData, { root = TSM_ROOT, privlevel = null } = {}) {
  if (!(reportData instanceof Uint8Array) || reportData.length !== 64) throw new Error('REPORT_DATA is 64 bytes');
  const dir = path.join(root, `reploid-${randomBytes(6).toString('hex')}`);
  await mkdir(dir);
  try {
    if (privlevel !== null) await writeFile(path.join(dir, 'privlevel'), String(privlevel));
    await writeFile(path.join(dir, 'inblob'), reportData);
    const before = (await readFile(path.join(dir, 'generation'), 'utf8')).trim();
    const provider = (await readFile(path.join(dir, 'provider'), 'utf8')).trim();
    const outblob = new Uint8Array(await readFile(path.join(dir, 'outblob')));
    let auxblob = new Uint8Array(0);
    try { auxblob = new Uint8Array(await readFile(path.join(dir, 'auxblob'))); } catch { /* TDX has none */ }
    const after = (await readFile(path.join(dir, 'generation'), 'utf8')).trim();
    if (before !== after) throw new Error('Another writer changed the report request; retry');
    return { provider, outblob, auxblob };
  } finally { await rmdir(dir).catch(() => {}); }
}

// SEV-SNP extended report certificate table GUIDs (GHCB spec, table "Certificate GUIDs").
const SNP_CERT_GUIDS = { 'c0b406a4-a803-4952-9743-3fb6014cd0ae': 'ark', '4ab7b379-bbac-4fe4-a02f-05aef327c782': 'ask',
  '63da758d-e664-4564-adc5-f4b93be8accd': 'vcek', 'a8074bc2-a25a-483e-aae6-39c045a0b8a1': 'vlek' };
const guidText = b => {
  const h = Buffer.from(b).toString('hex');
  const le = (s) => s.match(/../g).reverse().join('');
  return `${le(h.slice(0, 8))}-${le(h.slice(8, 12))}-${le(h.slice(12, 16))}-${h.slice(16, 20)}-${h.slice(20)}`;
};
export function parseSnpCertTable(aux) {
  const out = {};
  for (let o = 0; o + 24 <= aux.length; o += 24) {
    const guid = guidText(aux.subarray(o, o + 16));
    if (/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(guid)) break;
    const view = new DataView(aux.buffer, aux.byteOffset + o + 16, 8);
    const offset = view.getUint32(0, true), length = view.getUint32(4, true);
    if (SNP_CERT_GUIDS[guid]) out[SNP_CERT_GUIDS[guid]] = aux.slice(offset, offset + length);
  }
  return out;
}

const pemBlocks = text => [...String(text).matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)]
  .map(([, body]) => new Uint8Array(Buffer.from(body.replace(/\s+/g, ''), 'base64')));

/** AMD KDS: the VCEK for this chip and TCB, and the ASK/ARK chain of the product line. */
export async function fetchVcekChain(report, { product, fetchImpl = fetch, base = 'https://kdsintf.amd.com/vcek/v1' }) {
  const tcb = report.reportedTcb;
  const vcekUrl = `${base}/${product}/${report.chipId}?blSPL=${tcb.bootloader}&teeSPL=${tcb.tee}&snpSPL=${tcb.snp}&ucodeSPL=${tcb.microcode}`;
  const vcek = await fetchImpl(vcekUrl);
  if (!vcek.ok) throw new Error(`AMD KDS VCEK request failed: ${vcek.status}`);
  const chain = await fetchImpl(`${base}/${product}/cert_chain`);
  if (!chain.ok) throw new Error(`AMD KDS chain request failed: ${chain.status}`);
  const [ask, ark] = pemBlocks(await chain.text());
  return [new Uint8Array(await vcek.arrayBuffer()), ask, ark];
}

/** A collector for the platform this VM runs on (from configfs-tsm `provider`). */
export function createCpuCollector({ snpProduct = null, fetchImpl = fetch, root = TSM_ROOT } = {}) {
  return async reportData => {
    const { provider, outblob, auxblob } = await tsmReport(reportData, { root });
    if (provider.startsWith('sev_guest')) {
      const table = parseSnpCertTable(auxblob);
      if (table.vcek && table.ask && table.ark) return { report: outblob, certificates: [table.vcek, table.ask, table.ark] };
      if (!snpProduct) throw new Error('The host supplied no VCEK; pass the SNP product (Milan, Genoa) to fetch it from AMD KDS');
      return { report: outblob, certificates: await fetchVcekChain(parseSnpReport(outblob), { product: snpProduct, fetchImpl }) };
    }
    if (provider.startsWith('tdx_guest')) return { report: outblob, certificates: [] };
    throw new Error(`Unsupported configfs-tsm provider ${provider}`);
  };
}

// --- OCSP request (RFC 6960) for stapling ---
const len = n => n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff];
const tlv = (tag, ...parts) => { const v = Buffer.concat(parts.map(p => Buffer.from(p))); return Buffer.concat([Buffer.from([tag, ...len(v.length)]), v]); };
const SHA384_ALG = tlv(0x30, Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x02]), Buffer.from([0x05, 0x00]));
export function ocspRequest(certificate, issuer) {
  const h = bytes => createHash('sha384').update(bytes).digest();
  const serial = certificate.serial[0] & 0x80 ? Buffer.concat([Buffer.from([0]), certificate.serial]) : Buffer.from(certificate.serial);
  const certId = tlv(0x30, SHA384_ALG, tlv(0x04, h(issuer.subject)), tlv(0x04, h(issuer.publicKey.keyBits)), tlv(0x02, serial));
  return tlv(0x30, tlv(0x30, tlv(0x30, tlv(0x30, certId))));
}
export async function fetchOcsp(chainDer, { responder = 'http://ocsp.ndis.nvidia.com/', fetchImpl = fetch } = {}) {
  const chain = chainDer.map(parseCertificate);
  const out = [];
  for (let i = 0; i < chain.length - 1; i += 1) {
    const response = await fetchImpl(responder, { method: 'POST', headers: { 'content-type': 'application/ocsp-request' }, body: ocspRequest(chain[i], chain[i + 1]) });
    if (!response.ok) throw new Error(`OCSP request failed: ${response.status}`);
    out.push(new Uint8Array(await response.arrayBuffer()));
  }
  return out;
}

/** Order a certificate set leaf first by issuer linkage; NVML returns PEM in vendor order. */
export function orderChain(ders) {
  const parsed = ders.map(der => ({ der, cert: parseCertificate(der) }));
  const same = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
  const leaf = parsed.find(item => !parsed.some(other => other !== item && same(other.cert.issuer, item.cert.subject)));
  if (!leaf) throw new Error('No leaf certificate in the GPU chain');
  const out = [leaf];
  while (out.length < parsed.length) {
    const next = parsed.find(item => !out.includes(item) && same(item.cert.subject, out.at(-1).cert.issuer));
    if (!next) break;
    out.push(next);
  }
  return out.map(item => item.der);
}

const run = (command, args, { timeoutMs = 60000 } = {}) => new Promise((resolve, reject) => {
  execFile(command, args, { timeout: timeoutMs, maxBuffer: 16 << 20 }, (error, stdout, stderr) => error
    ? reject(new Error(`${command} failed: ${stderr || error.message}`)) : resolve(stdout));
});

/** GPU evidence through NVML (gpu-evidence.py), then OCSP stapling for each GPU's chain. */
export function createGpuCollector({ python = 'python3', script = path.join(here, 'gpu-evidence.py'), responder, fetchImpl = fetch } = {}) {
  return async nonce => {
    if (!(nonce instanceof Uint8Array) || nonce.length !== 32) throw new Error('The GPU nonce is 32 bytes');
    const output = JSON.parse(await run(python, [script, Buffer.from(nonce).toString('hex')]));
    const gpus = [];
    for (const gpu of output.gpus) {
      const certificates = orderChain(pemBlocks(gpu.certificateChainPem));
      gpus.push({ index: gpu.index, architecture: gpu.architecture, ccMode: gpu.ccMode, devToolsMode: gpu.devToolsMode,
        report: new Uint8Array(Buffer.from(gpu.report, 'base64')), certificates, ocsp: await fetchOcsp(certificates, { responder, fetchImpl }) });
    }
    return gpus;
  };
}

/**
 * The launch this image measured: hashes every listed runtime and model file and refuses to start on any mismatch.
 * Manifest `reploid.attested-gpu-launch/v1`: { image, runtime: { name, version, files }, model: { id, identity, files } },
 * files as [{ path, sha256 }]. The runtime digest is the SHA-256 of the canonical file list.
 */
export async function measureLaunch(manifest, { hashFile = defaultHashFile } = {}) {
  if (manifest?.schema !== 'reploid.attested-gpu-launch/v1') throw new Error('Expected a reploid.attested-gpu-launch/v1 manifest');
  for (const file of [...manifest.runtime.files, ...manifest.model.files]) {
    const actual = await hashFile(file.path);
    if (actual !== file.sha256) throw new Error(`Launch file ${file.path} does not match its manifest digest`);
  }
  const list = manifest.runtime.files.map(file => ({ path: file.path, sha256: file.sha256 })).sort((a, b) => a.path.localeCompare(b.path));
  const runtimeDigest = 'sha256:' + createHash('sha256').update(JSON.stringify(list)).digest('hex');
  return { image: manifest.image, runtime: { name: manifest.runtime.name, version: manifest.runtime.version, digest: runtimeDigest },
    model: { id: manifest.model.id, identity: manifest.model.identity } };
}
async function defaultHashFile(file) {
  const { createReadStream } = await import('node:fs');
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file).on('data', chunk => hash.update(chunk)).on('end', () => resolve('sha256:' + hash.digest('hex'))).on('error', reject);
  });
}
