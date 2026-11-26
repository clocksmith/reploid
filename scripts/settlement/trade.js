#!/usr/bin/env node
/**
 * The commands of one two-person trade on the charged route (docs/verify-a-trade.md, "Run a trade between two people").
 *
 *   node scripts/settlement/trade.js key      --state DIR [--name NAME]
 *   node scripts/settlement/trade.js earner   --state DIR --service URL --signaling URL --room ROOM --room-token-file FILE --model MODEL.json --weights DIR
 *   node scripts/settlement/trade.js spender  --state DIR --service URL --signaling URL --room ROOM --room-token-file FILE --model MODEL.json
 *   node scripts/settlement/trade.js export   --state DIR --out TRADE.json [--id RESERVATION]
 *   node scripts/settlement/trade.js outsider TRADE.json --coordinator-key KEY.json
 *
 * `key` makes this computer's signing key once and prints its public enrollment entry, which the person sends to
 * whoever runs the ledger. `earner` and `spender` check the ledger before starting anything: that this key is
 * enrolled and under which account, that the model is one the ledger credits, and that the ledger publishes a
 * coordinator key. They then write an owner-only host configuration and start the real native host
 * (server/fleet/native-host.js). `export` asks the spender's running host for the records-only file of a request.
 * `outsider` is scripts/settlement/verify-records.js.
 *
 * Optional flags: `--ca FILE` (a private certificate authority for the ledger), `--lan` (the two computers reach each
 * other directly; no relay servers), `--name NAME`, `--page-origin ORIGIN` (the page the spender pairs, and for both
 * roles the Origin the host gives the signaling server: a signaling server that listens on a loopback address accepts
 * only a loopback origin such as http://localhost:8000), `--verbose` (every state event of the host as JSON, instead
 * of one line per change), and for the spender `--bridge-port N`, `--manifest FILE` and `--allow-unsigned-hold` (run
 * against a ledger that signs no statement; the hold's release is then not proven and every export says so).
 *
 * Nothing here decides an amount, and none of it makes two keys two people: that is for the people to arrange.
 */
import fs from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openComputerIdentity } from '../../server/fleet/computer-identity.js';
import { createFleetClient } from '../../server/fleet/service.js';
import { readCoordinatorKey, recordsCommand } from './verify-records.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const assert = (ok, message) => { if (!ok) throw Error(message); };
const ownerFile = async (file, text) => {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, text, { mode: 0o600 });
  await fs.rename(temporary, file);
};

/** This computer's key (made once, owner-only) and the public entry a ledger operator enrolls it with. */
export async function tradeKey({ state, name = os.hostname().slice(0, 64) || 'This computer' }) {
  assert(typeof state === 'string' && path.isAbsolute(state), 'An absolute --state directory is required');
  const identity = await openComputerIdentity(path.join(state, 'identity.json'));
  return { identity, entry: { name: String(name).slice(0, 64), providers: [{ participantId: identity.peerId, publicJwk: identity.publicJwk }] } };
}

/** The ledger's published coordinator key, or null when it publishes none. */
export async function fetchCoordinatorKey(serviceUrl, { ca = null } = {}) {
  const target = `${serviceUrl.replace(/\/+$/, '')}/coordinator`;
  const read = ca && target.startsWith('https:') ? new Promise((resolve, reject) => {
    https.get(target, { ca }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject);
  }) : fetch(target, { signal: AbortSignal.timeout(15000) }).then(async response => ({ status: response.status, text: await response.text() }));
  const { status, text } = await read;
  if (status !== 200) return null;
  try { return readCoordinatorKey(JSON.parse(text)); } catch { return null; }
}

/**
 * Checks the ledger and writes the host configuration for one role. Returns `{ status: 'needs-enrollment', entry }`
 * when the ledger does not know this key yet, otherwise `{ status: 'ready', hostFile, config, account, computerId,
 * coordinator, notes }`. Starts nothing.
 */
export async function prepareTradeHost({ role, state, service, signaling, room, roomTokenFile, model, weights = null, manifest = null, ca = null,
  name = undefined, lan = false, bridgePort = 18784, pageOrigin = 'https://replo.id', allowUnsignedHold = false }) {
  assert(['earner', 'spender'].includes(role), 'The role is earner or spender');
  for (const [flag, value] of [['--service', service], ['--signaling', signaling], ['--room', room]]) assert(typeof value === 'string' && value, `${flag} is required`);
  assert(typeof roomTokenFile === 'string' && path.isAbsolute(roomTokenFile), 'An absolute --room-token-file is required');
  assert(model && typeof model.id === 'string' && /^sha256:[a-f0-9]{64}$/.test(model.identity ?? ''), '--model must name a JSON file holding the exact model entry the ledger credits');
  assert(Number.isSafeInteger(model.generation?.maxTokens) && model.generation.maxTokens > 0,
    'The model entry needs generation.maxTokens: a credited answer has an explicit output bound');
  const { identity, entry } = await tradeKey({ state, name });
  const caBytes = ca ? await fs.readFile(ca) : null;
  const client = createFleetClient({ url: service, identity, ca: caBytes });
  let statement;
  try { statement = await client.call('statementMine', {}); }
  catch (error) {
    if (/Invalid fleet request signature|Unenrolled computer/.test(error.message)) return { status: 'needs-enrollment', entry, participantId: identity.peerId };
    throw Error(`The ledger at ${service} did not answer this key: ${error.message}`);
  }
  const notes = [];
  const mine = (await client.call('computers', {})).computers.find(row => row.participantIds?.includes(identity.peerId));
  assert(mine, 'The ledger enrolls this key but lists no computer for it');
  const { policy } = await client.call('terms', { id: model.id, identity: model.identity });
  if (policy.wholeModelUnclaimedReleaseMs !== policy.partitionUnclaimedReleaseMs) {
    notes.push(`The ledger releases a silent whole-model hold after ${policy.wholeModelUnclaimedReleaseMs} ms but the signed terms name ${policy.partitionUnclaimedReleaseMs} ms: `
      + 'for the silent-provider drill, wait for the longer of the two before exporting.');
  }
  const coordinator = await fetchCoordinatorKey(service, { ca: caBytes });
  if (!coordinator) {
    assert(role === 'earner' || allowUnsignedHold, 'This ledger publishes no coordinator key, so it signs no settlement statement and the release of your hold could not be proven. '
      + 'Ask its operator to configure one, or pass --allow-unsigned-hold to run anyway.');
    notes.push('This ledger publishes no coordinator key: hold release will rest on the ledger\'s unsigned word.');
  }
  const directory = weights ? path.resolve(weights) : path.join(state, 'model');
  await fs.mkdir(directory, { recursive: true });
  const manifestFile = path.join(directory, 'manifest.json');
  if (!existsSync(manifestFile)) {
    // A spender holds no weights, only the model's manifest: the one named, or the one this repository pins for a catalog model.
    const bundled = path.join(repo, 'shared/config/model-manifests', `${model.identity.slice(7)}.json`);
    const pinned = existsSync(bundled) ? bundled : null, source = manifest ? path.resolve(manifest) : pinned;
    assert(role === 'spender' && source, role === 'earner' ? `No manifest.json in ${directory}: --weights must name the directory that holds this model's files`
      : 'No manifest for this model: pass --manifest FILE (the model\'s manifest.json)');
    await fs.copyFile(source, manifestFile);
  }
  assert('sha256:' + createHash('sha256').update(await fs.readFile(manifestFile)).digest('hex') === model.identity, `${manifestFile} is not the manifest of the model the ledger credits`);
  const bridgeTokenFile = path.join(state, 'browser-bridge-secret');
  if (role === 'spender' && !existsSync(bridgeTokenFile)) await ownerFile(bridgeTokenFile, randomBytes(32).toString('base64url'));
  const config = { schema: 'reploid.fleet-native/v1', computerId: mine.id, name: mine.name ?? entry.name, identityFile: path.join(state, 'identity.json'),
    roomId: room, roomTokenFile, signalingUrl: signaling, serviceUrl: service, ...(ca ? { serviceCaFile: path.resolve(ca) } : {}), origin: pageOrigin,
    ...(lan ? { hostCandidatesOnly: true } : {}), maxOutputTokens: Math.min(policy.maxOutputTokens, model.generation.maxTokens),
    tradeRecordsDirectory: path.join(state, 'trade-records'), daemon: true, initialModel: 0,
    ...(role === 'earner' ? { models: [{ model, directory, mode: 'whole-model' }], initialContribution: true }
      // The spender asks and never serves; every request must be answered by a contributor that signs the settlement records.
      : { models: [{ model, directory, mode: 'partition', ordered: null }], initialContribution: false, requireVerifiableCharge: true,
        browserBridge: { port: bridgePort, tokenFile: bridgeTokenFile, origins: [pageOrigin] } }) };
  const hostFile = path.join(state, 'host.json');
  await ownerFile(hostFile, JSON.stringify(config, null, 2) + '\n');
  return { status: 'ready', role, hostFile, config, participantId: identity.peerId, account: statement.accountId, computerId: mine.id, coordinator, policy, notes,
    ...(role === 'spender' ? { bridge: { url: `http://127.0.0.1:${bridgePort}`, secretFile: bridgeTokenFile, origin: pageOrigin } } : {}) };
}

/**
 * What a person watching the terminal needs from the running host, one line per change: whether the signaling server
 * took the connection, how many other computers are in the room, and for the earner when the model is loaded and
 * offered. The host reports its whole state several times a second; this keeps the lines that change what to do.
 */
export function tradeStatus({ role, signaling, say }) {
  const seen = { connection: null, peers: null, model: null, error: null, refused: false };
  const changed = (key, value) => { const is = seen[key] !== value; seen[key] = value; return is; };
  return value => {
    if (typeof value.warning === 'string') {
      // The transport reports a refused connection as an event object, which prints as nothing useful.
      if (/Signaling failed: \[object/.test(value.warning) && !seen.refused) {
        seen.refused = true;
        say(`NOT CONNECTED: the signaling server at ${signaling} refused this host or cannot be reached, so nobody can reach it. Check the address. `
          + 'A signaling server on a loopback address accepts only a loopback --page-origin (for example http://localhost:8000).');
      }
      return;
    }
    const connection = value.network?.connectionState ?? null, peers = value.network?.peerCount ?? null;
    if (connection && changed('connection', connection)) say(connection === 'connected' ? 'Signaling: connected.' : `Signaling: ${connection}.`);
    if (connection === 'connected') seen.refused = false;
    if (Number.isSafeInteger(peers) && changed('peers', peers)) say(`Other computers in the room: ${peers}.`);
    const model = role === 'earner' && value.preparing === false && value.execution?.ready === true && value.execution.offering === true;
    const offeredBefore = seen.model !== null;
    const notOffered = offeredBefore ? 'The model is no longer offered: this host is not serving.' : 'The model is loading: nothing can be served yet.';
    if (role === 'earner' && changed('model', model)) say(model ? `The model ${value.selected?.modelId ?? ''} is loaded and offered. This host can now serve.` : notOffered);
    if (changed('error', value.error ?? null) && value.error) say(`Host error: ${value.error}`);
  };
}

/** Asks the spender's running host, over its own bridge, for the records-only file of one request (the latest by default). */
export async function exportTrade({ state, id = null }) {
  const config = JSON.parse(await fs.readFile(path.join(state, 'host.json'), 'utf8'));
  assert(config.browserBridge, 'This host has no browser bridge: export from the spender\'s host');
  const token = (await fs.readFile(config.browserBridge.tokenFile, 'utf8')).trim();
  const call = async (route, body) => {
    const response = await fetch(`http://127.0.0.1:${config.browserBridge.port}${route}`, { method: 'POST', body: JSON.stringify(body),
      headers: { Origin: config.browserBridge.origins[0], Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    const value = await response.json();
    assert(response.ok, value.error || `The host answered ${response.status}`);
    return value;
  };
  if (!id) {
    const latest = (await call('/trades', {})).trades.find(row => row.role === 'requester');
    assert(latest, 'This host holds no records of a request it asked for');
    id = latest.reservationId;
  }
  return { id, trade: await call('/trade', { id, format: 'records' }) };
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === 'outsider') return recordsCommand(rest);
  const { values } = parseArgs({ args: rest, options: { state: { type: 'string' }, name: { type: 'string' }, service: { type: 'string' }, signaling: { type: 'string' },
    room: { type: 'string' }, 'room-token-file': { type: 'string' }, model: { type: 'string' }, weights: { type: 'string' }, manifest: { type: 'string' }, ca: { type: 'string' },
    lan: { type: 'boolean' }, verbose: { type: 'boolean' }, 'bridge-port': { type: 'string' }, 'page-origin': { type: 'string' }, 'allow-unsigned-hold': { type: 'boolean' }, out: { type: 'string' }, id: { type: 'string' } } });
  assert(['key', 'earner', 'spender', 'export'].includes(command) && values.state, 'Usage: node scripts/settlement/trade.js key|earner|spender|export --state DIR ... (see the top of this file), or outsider TRADE.json --coordinator-key KEY.json');
  const state = path.resolve(values.state);
  const sendThis = (entry, participantId) => {
    console.log(JSON.stringify(entry, null, 2));
    console.error(`\nThis computer's key is ${participantId}. Send the JSON above (public only) to whoever runs the ledger, with the account name you want to be paid into or charged from.`);
  };
  if (command === 'key') { const { identity, entry } = await tradeKey({ state, name: values.name }); return sendThis(entry, identity.peerId); }
  if (command === 'export') {
    assert(values.out, '--out TRADE.json is required');
    const { id, trade } = await exportTrade({ state, id: values.id ?? null });
    await fs.writeFile(path.resolve(values.out), JSON.stringify(trade, null, 2) + '\n');
    const records = trade.attempts?.[0]?.records?.length ?? 0;
    console.log(`${id}\n${trade.label ?? `NOT A TRADE: ${trade.reason}`}\n${records} signed records written to ${path.resolve(values.out)}`);
    if (!trade.attempts) process.exitCode = 1;
    return;
  }
  const prepared = await prepareTradeHost({ role: command, state, service: values.service, signaling: values.signaling, room: values.room,
    roomTokenFile: values['room-token-file'] && path.resolve(values['room-token-file']), model: values.model ? JSON.parse(await fs.readFile(path.resolve(values.model), 'utf8')) : null,
    weights: values.weights ?? null, manifest: values.manifest ?? null, ca: values.ca ?? null, name: values.name, lan: values.lan === true,
    ...(values['bridge-port'] ? { bridgePort: Number(values['bridge-port']) } : {}), ...(values['page-origin'] ? { pageOrigin: values['page-origin'] } : {}),
    allowUnsignedHold: values['allow-unsigned-hold'] === true });
  if (prepared.status === 'needs-enrollment') {
    sendThis(prepared.entry, prepared.participantId);
    console.error('The ledger does not know this key yet. Nothing was started. Run this command again once its operator has enrolled it.');
    process.exitCode = 3;
    return;
  }
  const say = line => console.error(line);
  say(`Key ${prepared.participantId}, enrolled as ${prepared.computerId}. ${command === 'earner' ? 'Payout account' : 'Account charged'}: ${prepared.account}.`);
  say(prepared.coordinator ? `The ledger's coordinator key is ${prepared.coordinator.coordinatorId}. Compare it with the one its operator published elsewhere.` : 'The ledger publishes NO coordinator key.');
  say(`Signed records are kept in ${prepared.config.tradeRecordsDirectory}. Settings: ${prepared.hostFile}`);
  for (const note of prepared.notes) say(`Note: ${note}`);
  if (prepared.bridge) say(`Pair the page (${prepared.bridge.origin}, Computers, your private computers) with ${prepared.bridge.url} and the secret in ${prepared.bridge.secretFile}.`);
  const { openFleetNativeHost, runFleetNativeCommands } = await import('../../server/fleet/native-host.js');
  const onChange = values.verbose === true ? value => process.stderr.write(JSON.stringify({ event: 'fleet-state', ...value }) + '\n')
    : tradeStatus({ role: command, signaling: values.signaling, say });
  const host = await openFleetNativeHost({ configuration: prepared.config, onChange });
  // The host process is up. For the earner the model loads next: the line "The model ... is loaded and offered" is when it can serve.
  console.log(JSON.stringify({ ready: true, role: command, computerId: prepared.computerId, participantId: prepared.participantId, account: prepared.account }));
  await runFleetNativeCommands({ host, config: prepared.config });
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = process.exitCode || 1; }
}
