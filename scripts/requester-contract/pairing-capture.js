/**
 * Captures real owner-pairing exchanges for the requester contract.
 *
 * The desktop is the real provider mesh with the real pairing store
 * (server/circles/owner-pairing.js) and the real admission rule
 * (server/circles/guest-access.js createHostRequesterRule), wired as
 * server/native-participant-runtime.js wires them. The phone is the real
 * requester with the web client's pairing code
 * (apps/poolday/host/owner-pairing.js over transport/owner-pairing.js).
 * The desktop owner's "y" or "n" at the terminal is given by the capture.
 * See harness.js for the WebRTC and WebSocket stand-ins.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import bootstrap from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { ownerPairingRoomMarker } from '../../packages/reploid/src/transport/index.js';
import { openOwnerPairing } from '../../server/circles/owner-pairing.js';
import { ownerPairingLink, ownerPairingPrompt } from '../../server/circles/owner-pairing-terminal.js';
import { createBrowserOwnerPairing, parseOwnerPairingUrl } from '../../apps/poolday/host/owner-pairing.js';
import { FIXED, FIXED_PAIRING, fixedIdentity, fixedModel } from './fixed-inputs.js';
import { createScheduler, withDeterministicRuntime, createFakeNetwork, createInProcessSignaling, quietLogger,
  createStubWholeModel, createProviderStack, createRequesterStack } from './harness.js';

export const PAIRING_SCENARIOS = Object.freeze(['pair-and-ask', 'wrong-code', 'expired-code', 'replayed-code', 'declined', 'wrong-desktop',
  'unpaired-request', 'new-connection-name', 'look-alike', 'desktop-forgot']);

const STORAGE_KEY = 'reploid.owner-paired-desktop:v1';
const describeError = error => error ? { message: error.message ?? String(error), name: error.name ?? null } : null;
const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: key => { data.delete(key); }, dump: () => Object.fromEntries(data) };
};
const publicState = state => ({ status: state.status, paired: state.paired, canSend: state.canSend, hostParticipantId: state.hostParticipantId,
  hostLabel: state.hostLabel, roomId: state.roomId, hostPeer: state.hostPeer ?? null, readyModel: state.readyModel ?? null, pairedAt: state.pairedAt });

/**
 * One owner-pairing scenario between the real phone-side and desktop-side code.
 *
 *   pair-and-ask         the phone pairs, then asks its desktop with a named-recipient request
 *   wrong-code           a well-formed code the desktop never issued gets no answer; the real code still works
 *   expired-code         the code is used at its expiry time and gets no answer
 *   replayed-code        the code is used again after a successful pairing and gets no answer
 *   declined             the desktop owner answers no; the code is spent
 *   wrong-desktop        the link names a desktop that is not in the room; the code is never sent
 *   unpaired-request     a phone that never paired asks the pairing desktop and is refused before the prompt
 *   new-connection-name  after pairing, both sides reconnect under new connection names and certificates
 *   look-alike           another desktop claims the paired desktop's id; the phone sends it nothing
 *   desktop-forgot       the desktop's pairing state was deleted; the phone is refused before the prompt
 */
export async function capturePairing({ scenario }) {
  if (!PAIRING_SCENARIOS.includes(scenario)) throw new Error(`Unknown pairing scenario ${scenario}`);
  const scheduler = createScheduler(), warnings = [], logger = quietLogger(warnings);
  const phases = [], signalingFrames = [];
  let frames = null;
  const phase = name => { frames = []; phases.push({ name, frames }); };
  const model = fixedModel(), roomId = FIXED.roomId, roomToken = ownerPairingRoomMarker(roomId);
  const desktopIdentity = fixedIdentity('providerEd25519'), phoneIdentity = fixedIdentity('requesterEd25519');
  const clock = { value: FIXED.now };
  const outcome = { scenario };
  // The look-alike says in its advertisement that it is the paired desktop. Its own code would not, so the claim is written in transit.
  const transform = scenario !== 'look-alike' ? null : ({ from, data }) => {
    const envelope = JSON.parse(data);
    if (from !== 'provider' || envelope.type !== 'reploid:peer-advertisement') return data;
    envelope.payload.peerId = desktopIdentity.peerId;
    envelope.payloadSize = JSON.stringify(envelope.payload).length;
    return JSON.stringify(envelope);
  };
  const network = createFakeNetwork({ post: scheduler.post, transform,
    tap: ({ from, data }) => frames?.push({ direction: from === 'requester' ? 'requester->provider' : 'provider->requester', data }) });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-pairing-capture-'));
  let requestIndex = 0;

  try {
    const { used } = await withDeterministicRuntime({ now: () => clock.value, uuids: FIXED_PAIRING.uuids, scheduler,
      randomValues: [FIXED.saltBytes, FIXED.saltBytes, FIXED.saltBytes], randomBytes: [FIXED_PAIRING.codeBytes] }, async () => {
      const signaling = createInProcessSignaling({ post: scheduler.post, tap: frame => signalingFrames.push(frame), logger });
      const shared = { signalingUrl: FIXED.signalingUrl, roomId, roomToken, publicRoomId: bootstrap.publicRoomId, model, logger };
      const open = [];

      /** A desktop started with owner pairing. `decision` is what its owner types when asked. */
      const startDesktop = async ({ identity = desktopIdentity, transportId = FIXED.providerTransportId, fingerprint = FIXED.providerFingerprint,
        file = 'owner-pairing.sqlite', decision = true }) => {
        const asked = [], calls = [];
        const pairing = await openOwnerPairing({ file: path.join(directory, file), hostParticipantId: identity.peerId,
          onRequest: request => { asked.push({ ...request, prompt: ownerPairingPrompt(request) }); pairing.decide(request.requestId, decision); } });
        const rtc = network.createRtc({ name: 'provider', fingerprint });
        const stack = createProviderStack({ ...shared, identity, transportId, ownerPairing: pairing,
          WebSocket: signaling.webSocketFor({ name: 'desktop', origin: FIXED.origin }), RTCPeerConnection: rtc.RTCPeerConnection,
          generateId: () => { throw new Error('The desktop issues no identifiers in this capture'); },
          generate: createStubWholeModel({ model, chunks: FIXED.answerChunks, completion: FIXED.completion, pause: () => scheduler.barrier(),
            onCall: messages => calls.push(structuredClone(messages)) }) });
        await scheduler.until(stack.connect());
        await scheduler.drain();
        const desktop = { stack, pairing, identity, asked, calls, transportId, fingerprint,
          close: async () => { await scheduler.until(stack.mesh.close()); await scheduler.drain(); pairing.close(); } };
        open.push(desktop);
        return desktop;
      };
      /** The phone: the real requester plus the web client's pairing code over `storage`. */
      const startPhone = async ({ storage = memoryStorage(), transportId = FIXED.requesterTransportId, fingerprint = FIXED.requesterFingerprint } = {}) => {
        const rtc = network.createRtc({ name: 'requester', fingerprint });
        const stack = createRequesterStack({ ...shared, identity: phoneIdentity, transportId,
          WebSocket: signaling.webSocketFor({ name: 'phone', origin: FIXED.origin }), RTCPeerConnection: rtc.RTCPeerConnection,
          generateId: () => FIXED_PAIRING.requestIds[requestIndex++] });
        const pairing = createBrowserOwnerPairing({ storage, getChannel: () => stack.pairingChannel(), connect: null, peerWaitMs: 0, now: Date.now });
        await scheduler.until(stack.mesh.connect());
        await scheduler.drain();
        const phone = { stack, pairing, storage, transportId, fingerprint,
          close: async () => { pairing.close(); await scheduler.until(stack.mesh.close()); await scheduler.drain(); } };
        open.push(phone);
        return phone;
      };
      const closeAll = async () => { for (const item of open.splice(0).reverse()) await item.close(); };

      /** Pair with what the link carries. An attempt the desktop does not answer is ended here after everything settled. */
      const pair = async (phone, target) => {
        const controller = new AbortController();
        let settled = null;
        const attempt = phone.pairing.pair({ ...target, signal: controller.signal }).then(record => { settled = { record }; }, error => { settled = { error }; });
        await scheduler.drain();
        const answered = settled !== null;
        if (!answered) { controller.abort(new Error('No answer from the desktop')); await attempt; }
        // What the real pairing code wrote to the phone's storage: one key, or nothing.
        const written = Object.entries(phone.storage.dump());
        return { answered, approved: answered && !settled.error, error: answered ? describeError(settled.error) : null,
          storageKey: written[0]?.[0] ?? null, storedRecord: written.length ? JSON.parse(written[0][1]) : null, stateAfter: publicState(phone.pairing.state()) };
      };
      /** A named-recipient request to the pinned desktop. A request nobody may receive is ended here after everything settled. */
      const askDesktop = async (phone, desktop) => {
        const controller = new AbortController();
        let settled = null;
        const asking = phone.stack.ask({ messages: structuredClone(FIXED.messages), threadId: FIXED.threadId, attemptId: FIXED.attemptId, signal: controller.signal,
          recipients: { kind: 'named', ids: [desktopIdentity.peerId] } }).then(value => { settled = { value }; }, error => { settled = { error }; });
        // The request settles through frames; a request with no eligible recipient waits and sends nothing.
        for (let turn = 0; turn < 4 && settled === null; turn++) await scheduler.drain();
        const waited = settled === null;
        if (waited) { controller.abort(new Error('No eligible recipient')); await asking; }
        await scheduler.drain();
        return { completed: !waited && !settled.error, waitedWithoutSending: waited, error: waited ? null : describeError(settled.error),
          content: settled.value?.result.content ?? null, providerIdentity: settled.value?.result.execution.providerIdentity ?? null,
          privacy: settled.value?.privacy ?? null, promptReachedDesktop: desktop.calls.length > 0 };
      };
      const issue = desktop => {
        const issued = desktop.pairing.issue();
        const link = ownerPairingLink({ code: issued.code, hostParticipantId: issued.hostParticipantId, room: roomId });
        outcome.issued = { ...issued, link, target: parseOwnerPairingUrl(link) };
        return outcome.issued.target;
      };
      const savedRecord = () => ({ [STORAGE_KEY]: JSON.stringify({ hostParticipantId: desktopIdentity.peerId, hostLabel: FIXED_PAIRING.desktopLabel, roomId, pairedAt: FIXED.now }) });

      try {
        if (scenario === 'pair-and-ask') {
          phase('connect');
          const desktop = await startDesktop({}), target = issue(desktop), phone = await startPhone();
          outcome.stateBefore = publicState(phone.pairing.state());
          phase('pairing');
          outcome.pairing = await pair(phone, target);
          outcome.desktopAsked = desktop.asked;
          outcome.desktopKnowsPhone = desktop.pairing.isOwner(phoneIdentity.peerId);
          phase('request');
          outcome.request = await askDesktop(phone, desktop);
        } else if (scenario === 'wrong-code') {
          phase('connect');
          const desktop = await startDesktop({}), target = issue(desktop), phone = await startPhone();
          phase('wrong-code');
          outcome.wrong = await pair(phone, { ...target, code: FIXED_PAIRING.wrongCode });
          phase('right-code');
          outcome.right = await pair(phone, target);
        } else if (scenario === 'expired-code') {
          phase('connect');
          const desktop = await startDesktop({}), target = issue(desktop), phone = await startPhone();
          clock.value = outcome.issued.expiresAt;
          outcome.clockAtAttempt = clock.value;
          phase('expired-code');
          outcome.attempt = await pair(phone, target);
          outcome.desktopAsked = desktop.asked;
        } else if (scenario === 'replayed-code') {
          phase('connect');
          const desktop = await startDesktop({}), target = issue(desktop), phone = await startPhone();
          phase('pairing');
          outcome.first = await pair(phone, target);
          phase('replayed-code');
          outcome.replay = await pair(phone, target);
          outcome.desktopAsked = desktop.asked;
        } else if (scenario === 'declined') {
          phase('connect');
          const desktop = await startDesktop({ decision: false }), target = issue(desktop), phone = await startPhone();
          phase('declined');
          outcome.attempt = await pair(phone, target);
          phase('code-after-decline');
          outcome.again = await pair(phone, target);
          outcome.desktopKnowsPhone = desktop.pairing.isOwner(phoneIdentity.peerId);
        } else if (scenario === 'wrong-desktop') {
          phase('connect');
          const desktop = await startDesktop({}), target = issue(desktop), phone = await startPhone();
          outcome.linkHost = fixedIdentity('lookAlikeEd25519').peerId;
          phase('wrong-desktop');
          outcome.attempt = await pair(phone, { ...target, hostParticipantId: outcome.linkHost });
          outcome.desktopAsked = desktop.asked;
        } else if (scenario === 'unpaired-request') {
          phase('connect');
          const desktop = await startDesktop({}), phone = await startPhone();
          outcome.stateBefore = publicState(phone.pairing.state());
          phase('request');
          outcome.request = await askDesktop(phone, desktop);
        } else if (scenario === 'new-connection-name') {
          phase('connect');
          let desktop = await startDesktop({});
          const target = issue(desktop);
          let phone = await startPhone();
          phase('pairing');
          outcome.pairing = await pair(phone, target);
          const storage = phone.storage;
          frames = null;
          await closeAll();
          phase('later-connect');
          desktop = await startDesktop({ transportId: FIXED_PAIRING.laterDesktopTransportId, fingerprint: FIXED_PAIRING.laterDesktopFingerprint });
          phone = await startPhone({ storage, transportId: FIXED_PAIRING.laterPhoneTransportId, fingerprint: FIXED_PAIRING.laterPhoneFingerprint });
          outcome.later = { desktopConnectionName: desktop.transportId, phoneConnectionName: phone.transportId, state: publicState(phone.pairing.state()) };
          phase('later-request');
          outcome.request = await askDesktop(phone, desktop);
        } else if (scenario === 'look-alike') {
          phase('connect');
          const lookAlike = await startDesktop({ identity: fixedIdentity('lookAlikeEd25519'), file: 'look-alike.sqlite' });
          const phone = await startPhone({ storage: memoryStorage(savedRecord()) });
          outcome.lookAlike = { connectionName: lookAlike.transportId, participantId: lookAlike.identity.peerId, advertisedPeerId: desktopIdentity.peerId };
          outcome.state = publicState(phone.pairing.state());
          outcome.catalogAvailability = phone.stack.requester.getModels().map(row => ({ id: row.id, availability: row.availability, providerIds: row.providerIds }));
          phase('request');
          outcome.request = await askDesktop(phone, lookAlike);
        } else if (scenario === 'desktop-forgot') {
          phase('connect');
          const desktop = await startDesktop({ file: 'fresh-owner-pairing.sqlite' });
          const phone = await startPhone({ storage: memoryStorage(savedRecord()) });
          outcome.state = publicState(phone.pairing.state());
          outcome.desktopKnowsPhone = desktop.pairing.isOwner(phoneIdentity.peerId);
          phase('request');
          outcome.request = await askDesktop(phone, desktop);
        }
      } finally {
        frames = null;
        await closeAll();
        signaling.close();
        await scheduler.drain();
      }
    });
    outcome.uuidsInOrder = used.uuids;
  } finally { await fs.rm(directory, { recursive: true, force: true }); }

  const parsed = phases.map(item => ({ name: item.name, frames: item.frames.map(({ direction, data }) => {
    const envelope = JSON.parse(data);
    if (JSON.stringify(envelope) !== data) throw new Error('A captured frame does not round-trip through JSON');
    return { direction, envelope };
  }) }));
  return {
    ...outcome,
    inputs: { roomId, roomToken, origin: FIXED.origin, now: FIXED.now, desktopLabel: FIXED_PAIRING.desktopLabel,
      phone: { transportId: FIXED.requesterTransportId, fingerprint: FIXED.requesterFingerprint, identity: 'requesterEd25519', participantId: phoneIdentity.peerId },
      desktop: { transportId: FIXED.providerTransportId, fingerprint: FIXED.providerFingerprint, identity: 'providerEd25519', participantId: desktopIdentity.peerId },
      model: { id: model.id, identity: model.identity, name: model.name }, messages: structuredClone(FIXED.messages), storageKey: STORAGE_KEY },
    phases: parsed, signaling: signalingFrames, warnings
  };
}
