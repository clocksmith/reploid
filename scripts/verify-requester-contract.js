#!/usr/bin/env node
/**
 * Checks packages/reploid/contracts/requester/requester-contract.json
 * against the code the web and native clients run. It fails when:
 *
 *   - a constant in the contract differs from the value the code uses;
 *   - a channel message in the contract is not a type the transport knows;
 *   - regenerating vectors.json gives other bytes than the committed file;
 *   - a frame of a freshly captured real exchange does not satisfy its contract
 *     schema, carries a member the contract does not describe, or has a type
 *     the contract has no entry for;
 *   - an error text listed under failures is no longer in its source file.
 *
 *   node scripts/verify-requester-contract.js
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bootstrap from '../shared/config/swarm-bootstrap.json' with { type: 'json' };
import profile from '../shared/config/reploid-library.json' with { type: 'json' };
import catalog from '../shared/config/chat-models.json' with { type: 'json' };
import { resolveConfig } from '../packages/reploid/src/config/index.js';
import { RTC_MESSAGE_TYPES } from '../packages/reploid/src/transport/message-types.js';
import { SIGNALING_MESSAGE_TYPES } from '../server/signaling-server.js';
import { hashJson } from '../packages/reploid/src/artifacts/signatures.js';
import { importVerificationKey, getIdentitySignAlgorithm, encodeBytes, fromBase64Url, createSigningIdentity } from '../packages/reploid/src/artifacts/identity.js';
import { getReceiptPayload } from '../packages/reploid/src/artifacts/receipt.js';
import { createExecutionPolicy } from '../packages/reploid/src/chat/execution-policy.js';
import { resolveSwarmJoin, resolveSwarmSignalingUrl } from '../shared/capabilities/communication/swarm-join-policy.js';
import { DEFAULT_RTC_CONFIG } from '../shared/pool/p2p-transport.js';
import { assertSupportedSchema, validate, undeclared } from './requester-contract/schema-validator.js';
import { captureExchange } from './requester-contract/capture.js';
import { capturePairing, PAIRING_SCENARIOS } from './requester-contract/pairing-capture.js';
import { ownerPairingCode, ownerPairingRequestId, ownerParticipantId, ownerPairingRoomMarker } from '../packages/reploid/src/transport/owner-pairing.js';
import { createOwnerPairingUrl } from '../apps/poolday/host/owner-pairing.js';
import { FIXED_IDENTITIES } from './requester-contract/fixed-inputs.js';
import { buildVectorsText, VECTORS_FILE } from './build-requester-contract-vectors.js';
import { attachmentInput, comparisonSources } from '../apps/poolday/host/document-comparison.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONTRACT_FILE = path.join(root, 'packages/reploid/contracts/requester/requester-contract.json');

const TOP_LEVEL = ['schema', 'scope', 'notCovered', 'constants', 'sources', 'signalingMessages', 'envelope', 'channelMessages',
  'objects', 'procedures', 'sequence', 'failures'];
const REQUIRED_CHANNEL_MESSAGES = ['sync-request', 'ping', 'pong', 'reploid:peer-advertisement', 'reploid:identity-challenge',
  'reploid:identity-proof', 'reploid:generation-admit', 'reploid:generation-admitted', 'reploid:generation-request',
  'reploid:generation-update', 'reploid:generation-result', 'reploid:generation-error', 'reploid:generation-cancel',
  'reploid:generation-recover', 'reploid:generation-recovery', 'reploid:receipt',
  'reploid:owner-pairing-request', 'reploid:owner-pairing-result'];
const REQUIRED_OBJECTS = ['identityBundle', 'publicJwk', 'privacyPolicy', 'executionRoute', 'privacyBinding', 'promptCommitmentInput',
  'receiptV2', 'generationTerminal', 'peerAdvertisement', 'chatModelCatalogRow', 'turnCredentials',
  'pairingCode', 'pairingLink', 'pairingRecord', 'pairedDesktopPolicy'];
const REQUIRED_PROCEDURES = ['canonicalJson', 'sha256Hex', 'base64url', 'peerIdFromPublicJwk', 'signatureAlgorithms',
  'identityProofSignedBytes', 'sdpFingerprint', 'promptCommitment', 'privacyBinding', 'admitPayloadFromRequest',
  'receiptVerification', 'receiptCountersign', 'readyPeerRule', 'providerSelectionRule', 'envelopeValidation', 'lamportTimestamp',
  'pairingLinkParse', 'pairingRoom', 'pairingExchange', 'pairedDesktopRecognition', 'pairedDesktopRequest', 'pairedDesktopOffline', 'pairingForget'];
const CAPTURES = [{ scenario: 'complete' }, { scenario: 'decline' }, { scenario: 'provider-failure' }, { scenario: 'cancel' },
  { scenario: 'recovery' }, { scenario: 'complete', direct: true }];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const at = (value, dotted) => dotted.split('.').reduce((node, key) => node == null ? undefined : node[key], value);
const pointerValue = (document, pointer) => pointer.split('/').slice(1).reduce((node, key) => node == null ? undefined : node[key.replace(/~1/g, '/').replace(/~0/g, '~')], document);
const leaves = (value, prefix) => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? Object.entries(value).flatMap(([key, item]) => leaves(item, `${prefix}.${key}`)) : [prefix];
const readText = file => fs.readFile(path.join(root, file), 'utf8');

/** The configuration the web client resolves (shared/capabilities/communication/library-adapter.js). */
function webConfiguration() {
  const location = { href: 'https://replo.id/' };
  const join = resolveSwarmJoin({ location, storage: null, policy: bootstrap });
  const signalingUrl = resolveSwarmSignalingUrl({ location, policy: bootstrap, join, privateOverride: null });
  const config = resolveConfig({ profile: profile.profile, overrides: {
    mesh: { enabled: true, roomId: join.roomId },
    webrtc: { signalingUrl, broadcastRoomId: join.roomId, transportOrder: ['webrtc'] } } }).value;
  return { join, signalingUrl, config };
}

async function exportedValue(file, symbol) {
  const module = await import(pathToFileURL(path.join(root, file)).href);
  const indexed = /^(\w+)\[(\d+)\]$/.exec(symbol);
  const value = indexed ? module[indexed[1]]?.[Number(indexed[2])] : module[symbol];
  return value instanceof RegExp ? { source: value.source, flags: value.flags } : value;
}

/**
 * Run every check. `contract` and `vectorsText` default to the committed files;
 * tests pass altered copies to show that a difference is noticed.
 * Returns { checks, failures }, where failures is a list of readable lines.
 */
export async function verifyRequesterContract({ contract, vectorsText } = {}) {
  contract ??= JSON.parse(await fs.readFile(CONTRACT_FILE, 'utf8'));
  vectorsText ??= await fs.readFile(VECTORS_FILE, 'utf8');
  const failures = [];
  let checks = 0;
  const expect = (ok, message) => { checks++; if (!ok) failures.push(message); };
  const guarded = async (label, run) => { try { await run(); } catch (error) { checks++; failures.push(`${label}: ${error.message}`); } };

  // --- shape
  expect(same(Object.keys(contract).sort(), [...TOP_LEVEL].sort()), `top-level keys must be exactly ${TOP_LEVEL.join(', ')}`);
  expect(contract.schema === 'reploid.requester-contract/v1', 'schema must be reploid.requester-contract/v1');
  expect(typeof contract.scope === 'string' && contract.scope.length > 0, 'scope must be a sentence');
  expect(Array.isArray(contract.notCovered) && contract.notCovered.length > 0, 'notCovered must list what is out of scope');
  for (const name of REQUIRED_CHANNEL_MESSAGES) expect(Object.hasOwn(contract.channelMessages || {}, name), `channelMessages lacks ${name}`);
  for (const name of REQUIRED_OBJECTS) expect(Object.hasOwn(contract.objects || {}, name), `objects lacks ${name}`);
  for (const name of REQUIRED_PROCEDURES) expect(typeof contract.procedures?.[name] === 'string' && contract.procedures[name].length > 0, `procedures lacks ${name}`);
  if (failures.length) return { checks, failures };

  // --- every schema uses only keywords the validator implements
  const schemas = [['envelope', contract.envelope],
    ...Object.entries(contract.signalingMessages).map(([type, entry]) => [`signalingMessages.${type}.schema`, entry.schema]),
    ...Object.entries(contract.channelMessages).map(([type, entry]) => [`channelMessages.${type}.payload`, entry.payload]),
    ...Object.entries(contract.objects).map(([name, schema]) => [`objects.${name}`, schema])];
  for (const [label, schema] of schemas) await guarded(label, () => { checks++; assertSupportedSchema(schema, contract, label); });
  for (const [type, entry] of Object.entries(contract.signalingMessages)) {
    expect(['client-to-server', 'server-to-client', 'relayed'].includes(entry.direction), `signalingMessages.${type}.direction is invalid`);
    expect(entry.schema?.properties?.type?.const === type, `signalingMessages.${type}.schema must fix type to "${type}"`);
  }
  for (const [type, entry] of Object.entries(contract.channelMessages)) {
    expect(['requester', 'provider', 'either'].includes(entry.sentBy), `channelMessages.${type}.sentBy is invalid`);
  }
  if (failures.length) return { checks, failures };

  // --- message types exist in the real vocabularies
  for (const type of Object.keys(contract.channelMessages)) expect(RTC_MESSAGE_TYPES.includes(type), `channelMessages.${type} is not in RTC_MESSAGE_TYPES`);
  expect(same(contract.envelope['x-knownTypes'], [...RTC_MESSAGE_TYPES]), 'envelope.x-knownTypes differs from RTC_MESSAGE_TYPES');
  for (const [type, entry] of Object.entries(contract.signalingMessages)) {
    if (entry.direction !== 'server-to-client') expect(SIGNALING_MESSAGE_TYPES.has(type), `signalingMessages.${type} is not a type the signaling server accepts`);
  }

  // --- a fresh exchange between the real requester and the real provider
  const captures = [];
  for (const options of CAPTURES) captures.push(await captureExchange(options));
  const [complete] = captures;
  expect(complete.error === null && typeof complete.result?.content === 'string', 'the fresh complete exchange did not finish');
  // --- fresh owner-pairing exchanges between the real phone-side and desktop-side code
  const pairings = {};
  for (const scenario of PAIRING_SCENARIOS) pairings[scenario] = await capturePairing({ scenario });
  const paired = pairings['pair-and-ask'];
  expect(paired.pairing?.approved === true && paired.request?.completed === true, 'the fresh pairing exchange did not pair and answer');

  // --- constants
  const web = webConfiguration();
  const payloadOf = type => complete.frames.find(frame => frame.envelope.type === type)?.envelope.payload;
  const admit = payloadOf('reploid:generation-admit'), request = payloadOf('reploid:generation-request'), result = payloadOf('reploid:generation-result');
  const proof = complete.frames.find(frame => frame.direction === 'provider->requester' && frame.envelope.type === 'reploid:identity-proof')?.envelope.payload;
  const challenge = complete.frames.find(frame => frame.direction === 'requester->provider' && frame.envelope.type === 'reploid:identity-challenge')?.envelope.payload;
  const ids = contract.constants.generation.schemaIds;
  let proofVerifies = false;
  try {
    const text = JSON.stringify([ids.identityProofDomain, challenge.roomId, challenge.nonce, challenge.requester, challenge.provider, challenge.local, challenge.remote, proof.participantId]);
    proofVerifies = await crypto.subtle.verify(getIdentitySignAlgorithm(proof.publicJwk), await importVerificationKey(proof.publicJwk), fromBase64Url(proof.signature), encodeBytes(text));
  } catch { proofVerifies = false; }
  const observations = {
    requesterDataChannel: complete.dataChannels.requesterCreated[0],
    providerAdvertisement: complete.frames.find(frame => frame.direction === 'provider->requester' && frame.envelope.type === 'reploid:peer-advertisement')?.envelope.payload,
    admit, request, result, dispatch: complete.dispatches[0],
    recomputedPromptCommitment: await hashJson({ schema: ids.promptCommitment, salt: request?.admission?.salt, messages: request?.messages, settings: null }) === admit?.promptCommitment
      ? ids.promptCommitment : 'a commitment the real requester did not send',
    recomputedIdentityProof: proofVerifies ? ids.identityProofDomain : 'a text the real proof was not signed over',
    pairing: {
      codeTtlMs: paired.issued.expiresAt - paired.inputs.now,
      storageKey: paired.pairing.storageKey,
      roomTokenPrefix: (() => {
        const token = paired.signaling.find(item => item.frame.type === 'join')?.frame.token ?? '';
        return token.endsWith(paired.inputs.roomId) ? token.slice(0, -paired.inputs.roomId.length) : token;
      })()
    }
  };
  const jsonCache = new Map(), textCache = new Map();
  const json = async file => { if (!jsonCache.has(file)) jsonCache.set(file, JSON.parse(await readText(file))); return jsonCache.get(file); };
  const text = async file => { if (!textCache.has(file)) textCache.set(file, await readText(file)); return textCache.get(file); };
  const sourceKeys = Object.keys(contract.sources);
  for (const leaf of leaves(contract.constants, 'constants')) {
    expect(sourceKeys.some(key => leaf === key || leaf.startsWith(`${key}.`)), `${leaf} has no entry in sources`);
  }
  for (const [key, source] of Object.entries(contract.sources)) {
    await guarded(`sources["${key}"]`, async () => {
      const value = at(contract, key);
      expect(value !== undefined, `sources["${key}"] names a constant that does not exist`);
      await text(source.file);
      expect(typeof source.pointer === 'string' || typeof source.symbol === 'string', `sources["${key}"] needs a pointer or a symbol`);
      if (source.pointer !== undefined) expect(same(pointerValue(await json(source.file), source.pointer), value),
        `${key} is ${JSON.stringify(value)} but ${source.file}#${source.pointer} is ${JSON.stringify(pointerValue(await json(source.file), source.pointer))}`);
      if (source.resolvedConfig !== undefined) expect(same(at(web.config, source.resolvedConfig), value),
        `${key} is ${JSON.stringify(value)} but the resolved web configuration ${source.resolvedConfig} is ${JSON.stringify(at(web.config, source.resolvedConfig))}`);
      if (source.check === 'export') {
        const actual = await exportedValue(source.file, source.symbol);
        expect(same(actual, value), `${key} is ${JSON.stringify(value)} but ${source.file} exports ${source.symbol} = ${JSON.stringify(actual)}`);
      }
      if (source.check === 'literal') {
        expect((await text(source.file)).includes(source.literal), `${key}: ${source.file} no longer contains ${JSON.stringify(source.literal)}`);
        // The literal must be the constant itself, not an unrelated line. A constant the code writes as a
        // product ("10 * 60 * 1000") names that product in `expression`.
        if (source.expression !== undefined) {
          const product = /^\d+( \* \d+)*$/.test(source.expression) ? source.expression.split(' * ').reduce((total, factor) => total * Number(factor), 1) : NaN;
          expect(source.literal.includes(source.expression) && product === value, `${key} is ${JSON.stringify(value)} but ${source.file} computes ${source.expression}`);
        } else {
          const scalars = typeof value === 'object' && value !== null ? Object.values(value).flat() : [value];
          expect(scalars.some(item => source.literal.includes(String(item))), `${key}: the literal ${JSON.stringify(source.literal)} does not contain the constant`);
        }
      }
      if (source.observed !== undefined) {
        const [head, ...rest] = source.observed.split('.');
        const actual = rest.length ? at(observations[head], rest.join('.')) : observations[head];
        expect(same(actual, value), `${key} is ${JSON.stringify(value)} but the real exchange shows ${source.observed} = ${JSON.stringify(actual)}`);
      }
      if (source.check !== undefined) expect(['export', 'literal', 'prose'].includes(source.check), `sources["${key}"].check is unknown`);
    });
  }
  // --- attachments: the markers and instruction are private to the web module, so check what it writes
  const attached = contract.constants.attachments;
  const sampleFiles = [{ name: 'a.txt', text: 'one\n\ntwo' }];
  const sampleDocuments = [{ id: 'D1', name: 'a.txt', passages: [{ id: 'D1:P1', text: 'one' }, { id: 'D1:P2', text: 'two' }] }];
  expect(attachmentInput('Q', sampleFiles) === `Q${attached.instruction}${attached.startMarker}${JSON.stringify(sampleDocuments)}${attached.endMarker}`,
    'constants.attachments no longer reproduce what the web client sends');
  expect(comparisonSources(attachmentInput('Q', sampleFiles))?.question === 'Q', 'the web client no longer reads its own attachment text back');
  // The web client's own join choice for the public room.
  const signaling = contract.constants.signaling;
  expect(web.join.scope === 'public' && web.join.roomId === signaling.publicRoomId && web.join.token === signaling.publicJoinToken,
    'the web join policy no longer chooses the public room and token in the contract');
  expect(web.signalingUrl === `${signaling.publicUrl}?scope=public&roomId=${signaling.publicRoomId}`,
    `the web signaling URL is ${web.signalingUrl}, not publicUrl with scope and roomId`);
  expect(same(Object.keys(signaling.queryParameters), ['scope', 'roomId']), 'queryParameters must describe scope and roomId');
  // What the web client connects with when relay credentials are unavailable.
  expect(same(DEFAULT_RTC_CONFIG.iceServers, contract.constants.rtc.iceServers), 'constants.rtc.iceServers differs from the web client\'s direct-only ICE servers (shared/pool/p2p-transport.js)');
  expect(observations.requesterDataChannel?.options?.ordered === contract.constants.rtc.ordered
    && !Object.hasOwn(observations.requesterDataChannel?.options ?? {}, 'maxRetransmits'), 'the data channel is not created with the contract options');
  expect(contract.envelope.properties.protocolVersion.const === contract.constants.rtc.envelopeProtocolVersion, 'envelope.protocolVersion differs from constants.rtc.envelopeProtocolVersion');
  // Patterns written twice (source form and JSON Schema form) must agree.
  const samples = ['abc', 'ab', 'A-b_9', '-abc', 'peer:abc', 'c0ffee00-0000-4000-8000-000000000001', 'x'.repeat(128), 'x'.repeat(129), 'reploid-swarm-public', 'REPLOID-SWARM-Room_1', 'reploid-swarm-', 'my-room'];
  for (const [constant, object] of [['peerIdPattern', 'transportPeerId'], ['roomIdPattern', 'roomId']]) {
    const real = new RegExp(signaling[constant].source, signaling[constant].flags), schema = new RegExp(contract.objects[object].pattern, 'u');
    expect(samples.every(sample => real.test(sample) === schema.test(sample)), `objects.${object}.pattern disagrees with constants.signaling.${constant}`);
  }

  // --- owner pairing: patterns, the routing marker, the link and the stored record
  const pairingConstants = contract.constants.pairing;
  const pairingSamples = ['QEFCQ0RFRkdISUpLTE1OT1BR', 'QEFCQ0RFRkdISUpLTE1OT1B', 'QEFCQ0RFRkdISUpLTE1OT1BRa', 'QEFCQ0RFRkdISUpLTE1OT1B+', 'QEFCQ0RFRkdISUpLTE1OT1B=', '________________________', '',
    'peer:6a8b857f196de4a859dd669d', 'peer:6A8B857F196DE4A859DD669D', 'peer:6a8b857f196de4a859dd669', 'peer:6a8b857f196de4a859dd669dd', '6a8b857f196de4a859dd669d',
    'bbbbbbbb-1111-4000-8000-000000000001', 'BBBBBBBB-1111-4000-8000-000000000001', 'bbbbbbbb-1111-4000-8000-00000000000', 'not-a-uuid'];
  for (const [constant, real] of [['codePattern', ownerPairingCode], ['participantIdPattern', ownerParticipantId], ['requestIdPattern', ownerPairingRequestId]]) {
    const pattern = new RegExp(pairingConstants[constant]);
    expect(pairingSamples.every(sample => pattern.test(sample) === real(sample)), `constants.pairing.${constant} disagrees with the real check in transport/owner-pairing.js`);
  }
  expect(contract.objects.pairingCode.pattern === pairingConstants.codePattern, 'objects.pairingCode.pattern differs from constants.pairing.codePattern');
  expect(ownerPairingRoomMarker(paired.inputs.roomId) === pairingConstants.roomTokenPrefix + paired.inputs.roomId, 'the routing marker is no longer roomTokenPrefix followed by the room id');
  expect(paired.issued.link.startsWith(`${pairingConstants.linkBase}#`) && createOwnerPairingUrl({ hostParticipantId: paired.issued.hostParticipantId, code: paired.issued.code }, pairingConstants.linkBase).startsWith(`${pairingConstants.linkBase}#`),
    'pairing links no longer start with constants.pairing.linkBase and a fragment');
  expect(same(Object.keys(pairingConstants.linkParameters), ['pair', 'host', 'room', 'name'])
    // The parser reads name from older links; the desktop writes no name, since a desktop's name is private to its owner.
    && same([...new URLSearchParams(new URL(paired.issued.link).hash.slice(1)).keys()], ['pair', 'host', 'room']), 'the desktop no longer writes exactly the link parameters pair, host, room (and never name)');
  expect(Buffer.from(paired.issued.code, 'base64url').length === pairingConstants.codeBytes, 'the pairing code is no longer codeBytes random bytes');
  const pairingExpectations = {
    'wrong-code': item => item.wrong.answered === false && item.right.approved === true,
    'expired-code': item => item.attempt.answered === false && item.desktopAsked.length === 0,
    'replayed-code': item => item.first.approved === true && item.replay.answered === false && item.desktopAsked.length === 1,
    declined: item => item.attempt.answered === true && item.attempt.approved === false && item.attempt.storedRecord === null && item.again.answered === false && item.desktopKnowsPhone === false,
    'wrong-desktop': item => /Could not find the verified desktop/.test(item.attempt.error?.message ?? '') && item.desktopAsked.length === 0
      && !item.phases.flatMap(part => part.frames).some(frame => frame.envelope.type === 'reploid:owner-pairing-request'),
    'unpaired-request': item => /declined/.test(item.request.error?.message ?? '') && item.request.promptReachedDesktop === false,
    'new-connection-name': item => item.later.state.status === 'online' && item.later.state.hostPeer === item.later.desktopConnectionName && item.request.completed === true,
    // Every serving computer is proven and none is the desktop: the request ends at once, without waiting or sending.
    'look-alike': item => item.state.status === 'offline' && item.request.waitedWithoutSending === false && item.request.promptReachedDesktop === false
      && /is not among the recipients its execution policy allows/.test(item.request.error?.message ?? '') && item.phases.find(part => part.name === 'request').frames.length === 0,
    'desktop-forgot': item => item.state.status === 'online' && /declined/.test(item.request.error?.message ?? '') && item.request.promptReachedDesktop === false
  };
  for (const [scenario, holds] of Object.entries(pairingExpectations)) expect(holds(pairings[scenario]), `the real pairing code no longer behaves as the contract says in the "${scenario}" case`);

  // --- frames of the fresh exchanges against the contract
  const senders = { 'requester->provider': 'requester', 'provider->requester': 'provider' };
  const pairingCaptures = Object.values(pairings).map(item => ({ scenario: `pairing ${item.scenario}`, frames: item.phases.flatMap(part => part.frames), keepalive: [], recovery: [], signaling: item.signaling }));
  for (const captured of [...captures, ...pairingCaptures]) {
    const label = `${captured.scenario}${captured.direct ? ' (direct)' : ''}`;
    for (const { direction, envelope } of [...captured.frames, ...captured.keepalive, ...captured.recovery]) {
      const where = `${label}: ${direction} ${envelope.type}`;
      for (const problem of validate(contract.envelope, envelope, contract)) expect(false, `${where}: envelope ${problem}`);
      expect(envelope.payloadSize === JSON.stringify(envelope.payload).length, `${where}: payloadSize is not the payload text length`);
      const entry = contract.channelMessages[envelope.type];
      expect(entry !== undefined, `${where}: no channelMessages entry for this type`);
      if (!entry) continue;
      expect(entry.sentBy === 'either' || entry.sentBy === senders[direction], `${where}: contract says sentBy ${entry.sentBy}`);
      for (const problem of validate(entry.payload, envelope.payload, contract)) expect(false, `${where}: payload ${problem}`);
      for (const member of undeclared(entry.payload, envelope.payload, contract)) expect(false, `${where}: payload member ${member} is not described by the contract`);
      checks++;
    }
    for (const { direction, frame } of captured.signaling) {
      const where = `${label}: signaling ${direction} ${frame.type}`;
      const entry = contract.signalingMessages[frame.type];
      expect(entry !== undefined, `${where}: no signalingMessages entry for this type`);
      if (!entry) continue;
      expect(entry.direction === 'relayed' || entry.direction === direction, `${where}: contract says ${entry.direction}`);
      for (const problem of validate(entry.schema, frame, contract)) expect(false, `${where}: ${problem}`);
      for (const member of undeclared(entry.schema, frame, contract)) expect(false, `${where}: member ${member} is not described by the contract`);
      checks++;
    }
  }
  // Every message type the contract describes for a request was seen in a real exchange.
  const seen = new Set([...captures, ...pairingCaptures].flatMap(captured => [...captured.frames, ...captured.keepalive, ...captured.recovery].map(frame => frame.envelope.type)));
  for (const type of Object.keys(contract.channelMessages)) expect(seen.has(type), `channelMessages.${type} was not exercised by any real exchange`);
  const failureFrame = captures[2].frames.find(frame => frame.envelope.type === 'reploid:generation-error')?.envelope.payload;
  expect(failureFrame?.terminal !== undefined, 'the provider-failure exchange carried no terminal evidence');

  // --- objects against real values
  const objectCheck = (name, value, label) => {
    for (const problem of validate(contract.objects[name], value, contract)) expect(false, `objects.${name} rejects ${label}: ${problem}`);
    checks++;
  };
  if (result?.receipt) expect(same(contract.objects.receiptV2['x-signedPayloadFields'], Object.keys(getReceiptPayload(result.receipt))),
    'objects.receiptV2.x-signedPayloadFields differs from the members getReceiptPayload builds, in order');
  if (failureFrame?.terminal) {
    const signedMembers = Object.keys(failureFrame.terminal).filter(key => !['publicJwk', 'signature'].includes(key));
    expect(same([...contract.objects.generationTerminal['x-signedPayloadFields']].sort(), signedMembers.sort()), 'objects.generationTerminal.x-signedPayloadFields differs from the signed members of a real terminal');
    objectCheck('generationTerminal', failureFrame.terminal, 'a real terminal');
  }
  for (const row of catalog) objectCheck('chatModelCatalogRow', row, `catalog row ${row.id}`);
  objectCheck('privacyPolicy', createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } }), 'the open-recipients policy');
  objectCheck('privacyPolicy', createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'named', ids: [FIXED_IDENTITIES.providerEd25519.peerId] } }), 'a named-recipients policy');
  if (admit) { objectCheck('privacyBinding', admit.privacyBinding, 'the binding the real requester sent'); objectCheck('executionRoute', admit.privacyBinding.route, 'the real route'); }
  if (request) objectCheck('promptCommitmentInput', { schema: ids.promptCommitment, salt: request.admission.salt, messages: request.messages, settings: null }, 'the real commitment input');
  for (const identity of [...Object.values(FIXED_IDENTITIES), await createSigningIdentity({ algorithm: 'Ed25519' }), await createSigningIdentity({ algorithm: 'ECDSA' })]) {
    objectCheck('identityBundle', identity, `a ${identity.algorithm} identity`);
  }
  objectCheck('pairingLink', paired.issued.target, 'the link the real parser read');
  objectCheck('pairingRecord', paired.pairing.storedRecord, 'the record the real pairing code stored');
  const pairedAdmit = paired.phases.find(part => part.name === 'request').frames.find(frame => frame.envelope.type === 'reploid:generation-admit')?.envelope.payload;
  if (pairedAdmit) {
    objectCheck('pairedDesktopPolicy', pairedAdmit.privacy, 'the policy of the real request to the paired desktop');
    expect(same(pairedAdmit.privacy.recipients, { kind: 'named', ids: [paired.issued.hostParticipantId] }) && pairedAdmit.privacyBinding.route.route.providerId === paired.issued.hostParticipantId,
      'the real request to the paired desktop no longer names exactly that desktop');
  } else expect(false, 'the paired request sent no admit');
  expect(validate(contract.objects.pairedDesktopPolicy, createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } }), contract).length > 0,
    'objects.pairedDesktopPolicy must refuse an open-recipients policy');
  objectCheck('turnCredentials', { schema: contract.constants.turn.responseSchemaId, issuedAt: new Date(0).toISOString(), expiresAt: new Date(600000).toISOString(),
    ttlSeconds: contract.constants.turn.ttlSeconds, rtcConfig: { iceTransportPolicy: 'all',
      iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp'], username: 'name', credential: 'secret', credentialType: 'password' }] } }, 'a credential response');
  const turnSource = await text(contract.sources['constants.turn.responseSchemaId'].file);
  for (const member of ['issuedAt', 'expiresAt', 'ttlSeconds', 'rtcConfig', 'iceTransportPolicy']) expect(turnSource.includes(member), `the TURN issuer no longer returns ${member}`);

  // --- vectors
  const freshVectors = await buildVectorsText();
  expect(freshVectors === vectorsText, 'vectors.json differs from a fresh build. Run: npm run build:requester-vectors');
  const vectors = JSON.parse(freshVectors);
  // The public key schema accepts exactly the shapes the real key import accepts.
  for (const item of vectors.identity.publicJwkAcceptance) {
    expect((validate(contract.objects.publicJwk, item.publicJwk, contract).length === 0) === item.importable,
      `objects.publicJwk and the real key import disagree on "${item.name}"`);
  }

  // --- sequence and failures
  contract.sequence.forEach((step, index) => {
    expect(step.step === index + 1 && typeof step.actor === 'string' && typeof step.onFailure === 'string', `sequence[${index}] needs step ${index + 1}, actor and onFailure`);
    for (const key of ['sends', 'expects']) {
      if (step[key] === undefined) continue;
      const known = step.channel === 'signaling' ? contract.signalingMessages : contract.channelMessages;
      expect(Object.hasOwn(known, step[key]), `sequence[${index}].${key} names ${step[key]}, which the contract does not define`);
    }
  });
  for (const failure of contract.failures) {
    if (failure.match === 'other') continue;
    const needle = failure.match === 'status' ? failure.text.replace(/^\d+ /, '') : failure.text;
    await guarded(`failures "${failure.text}"`, async () => {
      expect((await text(failure.source)).includes(needle), `failures: ${failure.source} no longer contains ${JSON.stringify(needle)}`);
    });
  }
  return { checks, failures };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { checks, failures } = await verifyRequesterContract();
  if (failures.length) {
    console.error(`Requester contract: ${failures.length} of ${checks} checks failed.`);
    for (const line of failures) console.error(`  - ${line}`);
    process.exitCode = 1;
  } else {
    console.log(`Requester contract: ${checks} checks passed (constants, message types, schemas on fresh real exchanges, vectors, failure texts).`);
  }
}
