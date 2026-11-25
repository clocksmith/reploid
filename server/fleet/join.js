#!/usr/bin/env node
/**
 * Join a hosted fleet account by the pairing code shown in the browser: `npx reploid join ABCD-EFGH`.
 *
 * This computer creates (or reuses) its own signing key, claims the code with a signature, prints the
 * key's fingerprint and waits while the person confirms that same fingerprint in the browser. After
 * confirmation it writes an owner-only fleet host configuration (`host.json`) that serves and spends
 * under the account, with a local browser bridge the page can claim once with the same code. Nothing
 * here starts serving; `node server/fleet/native-host.js <host.json>` does.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { signAsParticipant } from '../../shared/vendor/reploid/artifacts/participant-proofs.js';
import { openComputerIdentity } from './computer-identity.js';
import { keyFingerprint, normalizePairingCode, pairingClaimBody, pairingPollBody } from './self-serve.js';

export const DEFAULT_SERVICE_ORIGIN = 'https://replo.id';
export const DEFAULT_BRIDGE_PORT = 18784;
export const DEFAULT_STATE_DIRECTORY = path.join(os.homedir(), '.reploid', 'fleet');
const BRIDGE_CLAIM_MS = 60 * 60 * 1000;

const assert = (ok, message) => { if (!ok) throw Error(message); };
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason ?? Error('Stopped')); }, { once: true });
});

async function writeOwnerFile(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, contents, { mode: 0o600 });
  await fs.rename(temporary, file);
}

/** Origin-only service address: HTTPS, or loopback HTTP for local development. */
export function serviceOrigin(value = DEFAULT_SERVICE_ORIGIN) {
  const url = new URL(value);
  assert(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
    'The Reploid service must use HTTPS (or loopback HTTP for local development)');
  return url.origin;
}

/**
 * Claim, wait for confirmation, then write the host configuration. Returns the written paths and identity.
 * `onClaimed({ fingerprint, expiresAt })` runs once the code is claimed, before waiting.
 */
export async function joinFleetByCode({ code: entered, service = DEFAULT_SERVICE_ORIGIN, stateDirectory = DEFAULT_STATE_DIRECTORY,
  name = os.hostname().slice(0, 64) || 'This computer', bridgePort = DEFAULT_BRIDGE_PORT, weightsDirectory = path.join(os.homedir(), '.reploid', 'weights'),
  fetchImpl = fetch, now = Date.now, pollMs = 2000, timeoutMs = 10 * 60 * 1000, signal, onClaimed = () => {} }) {
  const code = normalizePairingCode(entered);
  assert(code, 'Enter the eight-character code shown in your browser, for example ABCD-EFGH');
  assert(path.isAbsolute(stateDirectory), 'Absolute state directory required');
  const origin = serviceOrigin(service);
  const identity = await openComputerIdentity(path.join(stateDirectory, 'identity.json'));
  const post = async (route, body) => {
    const response = await fetchImpl(origin + route, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(Error(answer.error || `Reploid service answered ${response.status}`), { code: answer.code, status: response.status });
    return answer;
  };
  const claimBody = pairingClaimBody({ code, participantId: identity.peerId, publicJwk: identity.publicJwk, name: String(name).trim().slice(0, 64),
    bridgePort, at: now(), nonce: randomUUID() });
  const claimed = await post('/v1/fleet/join', { ...claimBody, signature: await signAsParticipant(identity, claimBody.schema, claimBody) });
  const fingerprint = keyFingerprint(identity.peerId);
  assert(claimed.fingerprint === fingerprint, 'The service reported another computer’s fingerprint');
  await onClaimed({ fingerprint, expiresAt: claimed.expiresAt, pairingId: claimed.pairingId });

  const deadline = now() + timeoutMs;
  let confirmed = null;
  while (!confirmed) {
    signal?.throwIfAborted();
    assert(now() <= deadline, 'Nobody confirmed this computer in the browser in time. Make a new code and run join again.');
    const pollBody = pairingPollBody({ pairingId: claimed.pairingId, participantId: identity.peerId, at: now(), nonce: randomUUID() });
    const state = await post('/v1/fleet/join/status', { ...pollBody, signature: await signAsParticipant(identity, pollBody.schema, pollBody) });
    if (state.state === 'confirmed') confirmed = state;
    else if (['cancelled', 'expired'].includes(state.state)) throw Error(`The pairing was ${state.state} in the browser. Make a new code and run join again.`);
    else await sleep(pollMs, signal);
  }

  const files = {
    identityFile: path.join(stateDirectory, 'identity.json'),
    roomTokenFile: path.join(stateDirectory, 'room-token'),
    bridgeTokenFile: path.join(stateDirectory, 'browser-bridge-secret'),
    hostFile: path.join(stateDirectory, 'host.json')
  };
  await writeOwnerFile(files.roomTokenFile, confirmed.network.roomToken);
  await writeOwnerFile(files.bridgeTokenFile, randomBytes(32).toString('base64url'));
  const policy = confirmed.policy;
  const host = {
    schema: 'reploid.fleet-native/v1',
    computerId: confirmed.computerId,
    name: confirmed.name,
    identityFile: files.identityFile,
    roomId: confirmed.network.roomId,
    roomTokenFile: files.roomTokenFile,
    signalingUrl: confirmed.network.signalingUrl,
    serviceUrl: confirmed.network.serviceUrl,
    origin,
    maxOutputTokens: policy.maxOutputTokens,
    // Whole-model entries for the models this service credits; weights stay where `reploid serve` keeps them.
    models: confirmed.models.map(model => ({ model: { id: model.id, identity: model.identity, adapterIdentities: model.adapterIdentities ?? [] },
      directory: path.join(weightsDirectory, model.id), mode: 'whole-model' })),
    browserBridge: { port: bridgePort, tokenFile: files.bridgeTokenFile, origins: [origin],
      claim: { codeDigest: createHash('sha256').update(code).digest('hex'), expiresAt: now() + BRIDGE_CLAIM_MS } },
    daemon: true
  };
  await writeOwnerFile(files.hostFile, JSON.stringify(host, null, 2) + '\n');
  return { ...files, computerId: confirmed.computerId, accountLabel: confirmed.accountLabel, participantId: identity.peerId, fingerprint };
}

export async function runJoin(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    service: { type: 'string' }, name: { type: 'string' }, state: { type: 'string' }, 'bridge-port': { type: 'string' }, weights: { type: 'string' } } });
  assert(positionals.length === 1, 'Usage: npx reploid join ABCD-EFGH [--service https://replo.id] [--name "My laptop"] [--state DIR] [--bridge-port 18784] [--weights DIR]');
  const bridgePort = values['bridge-port'] === undefined ? DEFAULT_BRIDGE_PORT : Number(values['bridge-port']);
  assert(Number.isSafeInteger(bridgePort) && bridgePort >= 1024 && bridgePort <= 65535, '--bridge-port must be a port from 1024 to 65535');
  const joined = await joinFleetByCode({ code: positionals[0], service: values.service, name: values.name, bridgePort,
    ...(values.state ? { stateDirectory: path.resolve(values.state) } : {}), ...(values.weights ? { weightsDirectory: path.resolve(values.weights) } : {}),
    onClaimed: ({ fingerprint }) => error(`This computer's fingerprint is ${fingerprint}.\nConfirm that the browser shows the same fingerprint, then choose Confirm there. Waiting…`) });
  log(`Paired with ${joined.accountLabel}. Settings: ${joined.hostFile}`);
  log(`Start serving and answering for this account:\n  node ${path.join(path.dirname(fileURLToPath(import.meta.url)), 'native-host.js')} ${joined.hostFile}`);
  return joined;
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) {
  try { await runJoin(); }
  catch (cause) { console.error(cause.message); process.exitCode = 1; }
}
