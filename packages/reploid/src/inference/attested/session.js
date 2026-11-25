/**
 * `reploid.attested-gpu/v1`: one session per request between a requester and a confidential-VM executor.
 *
 *   requester -> challenge { nonce, model, launchId }               no content
 *   executor  -> evidence  [evidence JSON]                          fresh X25519 key, CPU and GPU reports
 *   requester    verifies everything (verifier.js); on any failure it sends `abort` and nothing else
 *   requester -> request   { session, enc } [HPKE ciphertext]       the only frame that carries content
 *   executor  -> delta*    { sequence } [ciphertext]                streamed text, under the exported response key
 *   executor  -> result    { sequence } [ciphertext]                final text, finish reason, token counts
 *   executor  -> error     { code }                                 plaintext code only, never content
 *
 * Frames are { header, blobs } as in server/protected-route/frame-socket.js; `inspectAttestedHeader` bounds every
 * blob before it is buffered. A frame out of order, of an unknown kind or that fails authentication ends the session.
 */
import { canonicalize, utf8, decodeUtf8, toBase64Url, decodeBase64Url, randomBytes, toHex, concatBytes } from './bytes.js';
import { setupBaseSender, setupBaseRecipient, responseCipher, generateX25519KeyPair, exportX25519PublicKey, ATTESTED_HPKE_SUITE } from './hpke.js';
import {
  ATTESTED_PROTOCOL, ATTESTED_EVIDENCE_SCHEMA, ATTESTED_SESSION_SCHEMA, verifyAttestedEvidence, sessionDigestBytes,
  expectedReportData, gpuClaims, attestationRejected
} from './verifier.js';

const KIB = 1024, MIB = 1024 * 1024;
export const ATTESTED_FRAME_CEILINGS = Object.freeze({ challenge: 0, evidence: 2 * MIB, abort: 0, request: 4 * MIB, delta: 64 * KIB, result: 4 * MIB, error: 0 });
export const ATTESTED_EXECUTOR_ERRORS = Object.freeze(['ATTESTED_SESSION_REFUSED', 'ATTESTED_SESSION_EXPIRED', 'ATTESTED_RUNTIME_FAILED', 'ATTESTED_REQUEST_INVALID']);
const DEFAULT_SESSION_MS = 10 * 60 * 1000;

export const attestedSessionError = (code, message) => Object.assign(new Error(message), { code });

/** Blob sizes a header announces, checked against its kind's ceiling before any blob byte is kept. */
export function inspectAttestedHeader(header) {
  if (!header || typeof header !== 'object' || header.schema !== ATTESTED_PROTOCOL || !Object.hasOwn(ATTESTED_FRAME_CEILINGS, header.kind)
    || !Array.isArray(header.blobs) || header.blobs.length > 1) throw new RangeError('Unrecognized attested frame');
  if (!header.blobs.every(size => Number.isSafeInteger(size) && size >= 0)) throw new RangeError('Invalid blob size');
  if (header.blobs.reduce((a, b) => a + b, 0) > ATTESTED_FRAME_CEILINGS[header.kind]) throw new RangeError(`${header.kind} exceeds its ceiling`);
  return header.blobs;
}

const frame = (kind, fields = {}, blob = null) => ({ header: { schema: ATTESTED_PROTOCOL, kind, ...fields, blobs: blob ? [blob.length] : [] }, blobs: blob ? [blob] : [] });
const responseAad = (sessionDigest, kind, sequence) => concatBytes(sessionDigest, utf8(`|${kind}|${sequence}`));
const requestInfo = sessionDigest => concatBytes(utf8(`${ATTESTED_PROTOCOL} request|`), sessionDigest);

async function receive(channel, kinds, timeoutMs) {
  const received = await channel.receive({ timeoutMs });
  inspectAttestedHeader(received?.header);
  if (!kinds.includes(received.header.kind)) throw attestedSessionError('ATTESTED_PROTOCOL_VIOLATION', `Unexpected ${received.header.kind} frame`);
  if (received.header.blobs.length !== (received.blobs?.length ?? 0)
    || received.header.blobs.some((size, index) => received.blobs[index].length !== size)) throw attestedSessionError('ATTESTED_PROTOCOL_VIOLATION', 'Blob size mismatch');
  return received;
}

/**
 * Requester side. Verifies the executor before sealing the prompt; with no valid proof it sends `abort` and
 * throws ATTESTATION_REJECTED. `onAttested(summary)` runs after verification and before the prompt is sealed.
 */
export async function runAttestedRequesterSession({ channel, policy, model, launchId = null, requestId, messages, generation,
  now = Date.now, hooks = {}, timeoutMs = 120000, generationTimeoutMs = 30 * 60 * 1000, signal, onAttested = () => {}, onDelta = () => {} }) {
  const nonce = randomBytes(32);
  const stats = { sent: 0, received: 0, bytesSent: 0, bytesReceived: 0 };
  const send = async value => { stats.sent += 1; stats.bytesSent += value.blobs.reduce((n, blob) => n + blob.length, 0); await channel.send(value); };
  const read = async (kinds, wait = timeoutMs) => {
    signal?.throwIfAborted();
    const value = await receive(channel, kinds, wait);
    stats.received += 1; stats.bytesReceived += value.blobs.reduce((n, blob) => n + blob.length, 0);
    return value;
  };
  await send(frame('challenge', { nonce: toBase64Url(nonce), model: { id: model.id, identity: model.identity }, launchId }));
  const offered = await read(['evidence', 'error']);
  if (offered.header.kind === 'error') throw attestedSessionError(ATTESTED_EXECUTOR_ERRORS.includes(offered.header.code) ? offered.header.code : 'ATTESTED_SESSION_REFUSED', 'The executor refused the session. Nothing was sent.');
  let evidence;
  try { evidence = JSON.parse(decodeUtf8(offered.blobs[0])); } catch { throw attestationRejected('evidence-invalid', 'The attestation evidence is not JSON'); }
  let attestation;
  try { attestation = await verifyAttestedEvidence(evidence, { policy, expected: { nonce, model, launchId }, now: now(), hooks }); }
  catch (error) { await channel.send(frame('abort')).catch(() => {}); throw error; }
  signal?.throwIfAborted();
  await onAttested(attestation);

  // The only content-bearing frame, sealed to the key the CPU report binds.
  const sessionDigest = hexBytes(attestation.sessionDigest);
  const { enc, context } = await setupBaseSender(attestation.executorKey, requestInfo(sessionDigest));
  const ciphertext = await context.seal(utf8(canonicalize({ requestId, messages, generation })), sessionDigest);
  const responses = await responseCipher(context, ATTESTED_PROTOCOL);
  await send(frame('request', { session: attestation.sessionDigest, enc: toBase64Url(enc) }, ciphertext));

  let text = '';
  for (let sequence = 0; ; sequence += 1) {
    const next = await read(['delta', 'result', 'error'], generationTimeoutMs);
    if (next.header.kind === 'error') {
      const code = ATTESTED_EXECUTOR_ERRORS.includes(next.header.code) ? next.header.code : 'ATTESTED_RUNTIME_FAILED';
      throw attestedSessionError(code, 'The attested executor stopped before a complete answer');
    }
    if (next.header.sequence !== sequence) throw attestedSessionError('ATTESTED_PROTOCOL_VIOLATION', 'Out-of-sequence frame');
    let body;
    try { body = JSON.parse(decodeUtf8(await responses.open(next.blobs[0], responseAad(sessionDigest, next.header.kind, sequence)))); }
    catch { throw attestedSessionError('ATTESTED_PROTOCOL_VIOLATION', 'A response frame failed authentication'); }
    if (next.header.kind === 'delta') {
      if (typeof body?.text !== 'string') throw attestedSessionError('ATTESTED_PROTOCOL_VIOLATION', 'Invalid delta');
      text += body.text;
      onDelta(body.text);
      continue;
    }
    if (typeof body?.text !== 'string' || (text !== '' && body.text !== text) || !Number.isSafeInteger(body?.usage?.inputTokens)
      || !Number.isSafeInteger(body?.usage?.outputTokens)) throw attestedSessionError('ATTESTED_PROTOCOL_VIOLATION', 'The result does not match its stream');
    return { output: { text: body.text, finishReason: body.finishReason ?? 'unknown', stopReason: body.stopReason ?? null },
      usage: { inputTokens: body.usage.inputTokens, outputTokens: body.usage.outputTokens },
      timing: typeof body.timing === 'object' && body.timing ? body.timing : null, attestation, frames: stats };
  }
}

const hexBytes = value => Uint8Array.from(value.replace('sha256:', '').match(/../g), h => parseInt(h, 16));

/**
 * Executor side, inside the confidential VM. The host supplies:
 *   participantId, platform ('amd-sev-snp' | 'intel-tdx'), launch ({ image, runtime, model }: what this image measured)
 *   collectGpuEvidence(nonce32)    -> [{ index, architecture, ccMode, devToolsMode, report, certificates, ocsp }] (bytes)
 *   collectCpuEvidence(reportData) -> { report, certificates } (bytes; certificates leaf first)
 *   generate({ messages, generation, signal, onDelta }) -> { text, finishReason, stopReason, usage }
 * The X25519 key pair is made per session, non-extractable, and dropped when the session ends.
 * `log` receives sizes, timings and codes only.
 */
export async function serveAttestedSession({ channel, host, now = Date.now, sessionMs = DEFAULT_SESSION_MS, timeoutMs = 120000, log = () => {} }) {
  const started = now();
  const fail = async (code, detail) => { log({ outcome: 'refused', code, detail, ms: now() - started }); await channel.send(frame('error', { code })).catch(() => {}); channel.close?.(); return { outcome: 'refused', code }; };
  let challenge;
  try { challenge = await receive(channel, ['challenge'], timeoutMs); } catch (error) { channel.close?.(); return { outcome: 'closed', error: error.message }; }
  let nonce;
  try { nonce = decodeBase64Url(challenge.header.nonce, { length: 32 }); } catch { return fail('ATTESTED_REQUEST_INVALID', 'nonce'); }
  if (challenge.header.model?.identity !== host.launch.model.identity || challenge.header.model?.id !== host.launch.model.id) {
    return fail('ATTESTED_SESSION_REFUSED', 'model');
  }
  const keyPair = await generateX25519KeyPair();
  const issuedAt = now();
  const session = { schema: ATTESTED_SESSION_SCHEMA, protocol: ATTESTED_PROTOCOL, requesterNonce: toBase64Url(nonce),
    executor: { participantId: host.participantId, kem: 'DHKEM(X25519, HKDF-SHA256)', publicKey: toBase64Url(await exportX25519PublicKey(keyPair.publicKey)) },
    platform: host.platform, launch: structuredClone(host.launch), issuedAt, expiresAt: issuedAt + sessionMs };
  const sessionDigest = await sessionDigestBytes(session);
  let evidence;
  try {
    const gpuItems = await host.collectGpuEvidence(sessionDigest);
    const gpus = gpuItems.map(gpu => ({ index: gpu.index, architecture: gpu.architecture, ccMode: gpu.ccMode, devToolsMode: gpu.devToolsMode,
      report: toBase64Url(gpu.report), certificates: gpu.certificates.map(toBase64Url), ocsp: gpu.ocsp.map(toBase64Url) }));
    const reportData = await expectedReportData(sessionDigest, await Promise.all(gpus.map(gpuClaims)));
    const cpu = await host.collectCpuEvidence(reportData);
    evidence = { schema: ATTESTED_EVIDENCE_SCHEMA, session, cpu: { platform: host.platform, report: toBase64Url(cpu.report),
      certificates: cpu.certificates.map(toBase64Url) }, gpus };
  } catch (error) { return fail('ATTESTED_SESSION_REFUSED', `evidence: ${error.message}`); }
  const evidenceBytes = utf8(JSON.stringify(evidence));
  // The requester may have left while the evidence was collected; that ends this session and nothing else.
  try { await channel.send(frame('evidence', {}, evidenceBytes)); } catch (error) { channel.close?.(); return { outcome: 'closed', error: error.message }; }
  log({ stage: 'evidence', bytes: evidenceBytes.length, ms: now() - started, session: `sha256:${toHex(sessionDigest)}` });

  let request;
  try { request = await receive(channel, ['request', 'abort'], timeoutMs); } catch (error) { channel.close?.(); return { outcome: 'closed', error: error.message }; }
  if (request.header.kind === 'abort') { log({ outcome: 'aborted-by-requester', ms: now() - started }); channel.close?.(); return { outcome: 'aborted' }; }
  if (now() >= session.expiresAt) return fail('ATTESTED_SESSION_EXPIRED', 'expired');
  if (request.header.session !== `sha256:${toHex(sessionDigest)}`) return fail('ATTESTED_REQUEST_INVALID', 'session');
  let body, responses;
  try {
    const context = await setupBaseRecipient(decodeBase64Url(request.header.enc, { length: 32 }), keyPair, requestInfo(sessionDigest), { suite: ATTESTED_HPKE_SUITE });
    body = JSON.parse(decodeUtf8(await context.open(request.blobs[0], sessionDigest)));
    responses = await responseCipher(context, ATTESTED_PROTOCOL);
  } catch { return fail('ATTESTED_REQUEST_INVALID', 'decrypt'); }
  if (!Array.isArray(body?.messages) || !body.messages.length) return fail('ATTESTED_REQUEST_INVALID', 'messages');
  let sequence = 0, firstOutputMs = null;
  const sealed = async (kind, value) => {
    const ct = await responses.seal(utf8(JSON.stringify(value)), responseAad(sessionDigest, kind, sequence));
    await channel.send(frame(kind, { sequence }, ct));
    sequence += 1;
  };
  const generationStarted = now();
  let pending = Promise.resolve();
  try {
    const answer = await host.generate({ messages: body.messages, generation: body.generation ?? {}, signal: undefined,
      onDelta: text => { if (firstOutputMs === null) firstOutputMs = now() - generationStarted; pending = pending.then(() => sealed('delta', { text })); } });
    await pending;
    await sealed('result', { text: answer.text, finishReason: answer.finishReason ?? 'unknown', stopReason: answer.stopReason ?? null,
      usage: answer.usage, timing: { firstOutputMs, generationMs: now() - generationStarted } });
  } catch (error) {
    await pending.catch(() => {});
    return fail('ATTESTED_RUNTIME_FAILED', `runtime: ${String(error?.code ?? 'error')}`);
  }
  log({ outcome: 'completed', frames: sequence, ms: now() - started, firstOutputMs, generationMs: now() - generationStarted });
  channel.close?.();
  return { outcome: 'completed', frames: sequence };
}

/** An in-process frame channel pair, for tests and same-process hosts. */
export function createAttestedChannelPair() {
  const make = () => ({ queue: [], waiters: [], closed: false });
  const a = make(), b = make();
  const end = (self, peer) => ({
    async send(value) {
      if (self.closed || peer.closed) throw attestedSessionError('ATTESTED_SESSION_CLOSED', 'The channel is closed');
      inspectAttestedHeader(value.header);
      const copy = { header: structuredClone(value.header), blobs: value.blobs.map(blob => new Uint8Array(blob)) };
      const waiter = peer.waiters.shift();
      if (waiter) waiter.resolve(copy); else peer.queue.push(copy);
    },
    receive({ timeoutMs = 60000 } = {}) {
      if (self.queue.length) return Promise.resolve(self.queue.shift());
      if (self.closed) return Promise.reject(attestedSessionError('ATTESTED_SESSION_CLOSED', 'The channel closed'));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { self.waiters.splice(self.waiters.indexOf(waiter), 1); reject(attestedSessionError('ATTESTED_SESSION_CLOSED', 'No answer in time')); }, timeoutMs);
        const waiter = { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } };
        self.waiters.push(waiter);
      });
    },
    close() {
      for (const side of [self, peer]) {
        side.closed = true;
        for (const waiter of side.waiters.splice(0)) waiter.reject(attestedSessionError('ATTESTED_SESSION_CLOSED', 'The channel closed'));
      }
    }
  });
  return [end(a, b), end(b, a)];
}
