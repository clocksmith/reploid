/**
 * Stage 1 host adapter for one machine: three OS processes (a zero-weight requester and two complementary stage
 * hosts) plus signaling and the real fleet credit ledger in this process. The model runtime is fake, so a receipt
 * from this adapter is `fake-runtime` class and can never meet physical expectations.
 */
import { fork } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import SignalingServer from '../../server/signaling-server.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { createFleetClient, startFleetService } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { countersignReceipt, createReceiptDraft, signReceiptDraft } from '../../packages/reploid/src/artifacts/receipt.js';
import { measureWholeModelReceipt } from '../../packages/reploid/src/artifacts/whole-model-receipt.js';
import { observeInventory } from './inventory.js';
import { stage1Decoding } from './expectations.js';
import { collectAcceptances, collectSettlementReplay, dropRecord, ledgerTrace, openReservationCount, reservationsOnThread, runGatedCancel, runGatedDrop, until,
  verifySplitTokens } from './split-evidence.js';

const PROCESS_FILE = fileURLToPath(new URL('./local-process.js', import.meta.url));
const ROLES = Object.freeze(['requester', 'stage0', 'stage1']);
const HOSTS = Object.freeze([{ label: 'host-a', role: 'stage0' }, { label: 'host-b', role: 'stage1' }]);
const COMMAND_MS = 60000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
/** The whole-model control the requester's account serves to earn credits. Fake runtime: no model loads. */
const EARN_MODEL = Object.freeze({ id: 'stage1-earn-control', identity: 'sha256:' + createHash('sha256').update('stage1-earn-control').digest('hex') });
const EARN_REQUESTS = 2;
/**
 * A short credit policy so a dropped answer expires within the test: the normal split finishes in a few seconds, well
 * inside `maxRequestMs`, and the ledger's own expiry releases the dropped hold one window after its deadline.
 */
const LOCAL_MAX_REQUEST_MS = 15000, LOCAL_RELEASE_WINDOW_MS = 1000;

function startProcess(role, directory) {
  const child = fork(PROCESS_FILE, [role], { cwd: directory, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { PATH: process.env.PATH, HOME: directory, NODE_ENV: 'test',
      ...(process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {}) } });
  const node = { role, child, pending: new Map(), stderr: '', exited: false };
  child.stderr.on('data', chunk => { node.stderr = (node.stderr + chunk).slice(-4000); });
  node.identity = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => reject(Error(`${role} exited ${code} before reporting its identity: ${node.stderr}`)));
    child.on('message', value => {
      if (value.event === 'identity') { resolve(value); return; }
      const waiting = node.pending.get(value.id);
      if (!waiting) return;
      node.pending.delete(value.id); clearTimeout(waiting.timer);
      if (value.error) waiting.reject(Error(`${role}: ${value.error}`)); else waiting.resolve(value.result);
    });
  });
  node.identity.catch(() => {});
  child.on('exit', () => {
    node.exited = true;
    for (const waiting of node.pending.values()) { clearTimeout(waiting.timer); waiting.reject(Error(`${role} exited`)); }
    node.pending.clear();
  });
  node.call = (op, body = {}, timeoutMs = COMMAND_MS) => new Promise((resolve, reject) => {
    if (node.exited) { reject(Error(`${role} has exited`)); return; }
    const id = randomUUID(), timer = setTimeout(() => { node.pending.delete(id); reject(Error(`${role} ${op} timed out`)); }, timeoutMs);
    node.pending.set(id, { resolve, reject, timer });
    node.child.send({ id, op, body });
  });
  return node;
}

export function createLocalStage1Adapter({ directory, expectations, stageRanges, model, fixture, fixtureBytes, fixtureFile,
  fakeMemoryBytes = { 'host-a': 6442450944, 'host-b': 15032385536 } }) {
  if (!path.isAbsolute(directory)) throw Error('Absolute Stage 1 work directory required');
  const nodes = new Map();
  const roomId = 'reploid-swarm-stage1-' + randomUUID(), roomToken = randomBytes(24).toString('hex');
  const splitThread = 'stage1-split-' + randomUUID(), cancelThread = 'stage1-cancel-' + randomUUID(), dropThread = 'stage1-drop-' + randomUUID();
  const fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
  const witnessFile = role => path.join(directory, role, 'state', 'token-witness.json');
  const inventorySource = 'fake-runtime-declared';
  let credits = null, service = null, signaling = null, httpServer = null, peers = null, earner = null, buyer = null;
  const accountBalance = computerId => credits.snapshot().accounts.find(row => row.id === computerId)?.balance ?? null;

  const node = role => nodes.get(role);
  // Declared by this fake: it reports each stage's own ranges, so its zero outside-stage count shows nothing.
  // A real host searches for all ranges (host-control.js), and physical expectations refuse this source.
  const hostInventory = index => observeInventory({ held: stageRanges[index], stageRanges: stageRanges[index], source: inventorySource });

  async function startCoordinator() {
    httpServer = http.createServer((_request, response) => { response.statusCode = 404; response.end(); });
    signaling = new SignalingServer({ path: '/swarm' });
    httpServer.on('upgrade', (request, socket, head) => {
      if (signaling.shouldHandle(request)) signaling.handleUpgrade(request, socket, head); else socket.destroy();
    });
    httpServer.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    credits = await openFleetCredits({ file: path.join(directory, 'credits.sqlite'),
      // The requester's account has two devices: the zero-weight requester and the device that earns by serving.
      computers: [...ROLES.map(role => ({ id: `computer-${role}`, name: role, ownerId: `owner-${role}`,
        providers: [{ participantId: peers[role].participantId, publicJwk: peers[role].publicJwk },
          ...(role === 'requester' ? [{ participantId: earner.peerId, publicJwk: earner.publicJwk }] : [])] })),
      { id: 'computer-buyer', name: 'buyer', ownerId: 'owner-buyer', providers: [{ participantId: buyer.peerId, publicJwk: buyer.publicJwk }] }],
      policy: { schema: 'reploid.service-credit-policy/v1', version: 'stage1-local/1', unit: 'noncash-service-credit',
        creditsPerOutputToken: expectations.creditsPerOutputToken, maxDebt: 1000, maxOutputTokens: fixture.maxOutputTokens,
        maxPendingPerComputer: 2, maxClockSkewMs: 10000, maxRequestMs: LOCAL_MAX_REQUEST_MS, allowSameOwner: false, wholeModelTerminalCharge: 0,
        partitionUnclaimedReleaseMs: LOCAL_RELEASE_WINDOW_MS } });
    service = await startFleetService({ credits, models: [{ ...model, plans: [{ id: model.partitionPlanId, creditWeights: expectations.creditWeights }] }, { ...EARN_MODEL }],
      placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 } });
  }

  const nodeConfig = role => ({ modelDirectory: path.join(directory, role, 'model'), stateDirectory: path.join(directory, role, 'state'),
    signalingUrl: `ws://127.0.0.1:${httpServer.address().port}/swarm`, roomId, roomToken, serviceUrl: service.url,
    maxOutputTokens: fixture.maxOutputTokens, reference: fixture.reference,
    ...(role === 'requester' ? {} : { fakeMemoryBytes: fakeMemoryBytes[HOSTS.find(host => host.role === role).label],
      assignedRanges: stageRanges[HOSTS.findIndex(host => host.role === role)],
      witness: { fixtureFile, fixtureSha256, receiptFile: witnessFile(role), threadId: splitThread,
        requesterId: peers.requester.participantId, stageParticipants: [peers.stage0.participantId, peers.stage1.participantId] } }) });

  const settled = (id, signal) => until(() => credits.request(id)?.state === 'settled', { timeoutMs: 20000, label: 'settlement', signal });
  const computerOf = id => credits.enrollment.byPeer.get(id)?.computerId ?? id;
  const stageNodes = () => HOSTS.map(host => node(host.role));
  const replay = (attemptId, options = {}) => collectSettlementReplay({ requester: node('requester'), stages: stageNodes(), attemptId,
    policy: credits.policy, computerOf, ...options });

  /** After the kill: the ledger's own expiry releases the hold; then what the requester kept, and the replay. */
  async function finishDrop({ drop, accountBefore, signal }) {
    const { attemptId, collected } = drop, requester = node('requester');
    const { terms } = await requester.call('settlement-records', { attemptId });
    const reservationId = terms?.reservationId ?? `service:${peers.requester.participantId}:${attemptId}`;
    const { maxRequestMs, partitionUnclaimedReleaseMs } = credits.policy;
    // snapshot() runs the ledger's expiry; nothing here releases the hold itself.
    await until(() => { credits.snapshot(); return credits.request(reservationId)?.state === 'settled'; },
      { timeoutMs: maxRequestMs + partitionUnclaimedReleaseMs + 15000, label: 'the dropped hold to expire on the ledger', signal, pollMs: 250 });
    const settlementReplay = await replay(attemptId, { acceptancesSigned: 'during-attempt',
      prefetched: { acceptances: collected.acceptances, stageRecords: [collected.killedRecords, null] } });
    const own = await requester.call('settlement-records', { attemptId });
    return dropRecord({ drop, own, settlementReplay, accountBefore, accountAfter: accountBalance('computer-requester'),
      settlement: await ledgerTrace(credits, reservationId),
      ledgerReservations: await reservationsOnThread(path.join(directory, 'credits.sqlite'), dropThread) });
  }

  return Object.freeze({
    describe: () => ({ runtimeClass: 'fake-runtime', adapter: 'local-three-process' }),
    processIds: () => [...nodes.values()].map(item => item.child.pid),
    async preflight({ signal }) {
      for (const role of ROLES) {
        await fs.mkdir(path.join(directory, role), { recursive: true, mode: 0o700 });
        nodes.set(role, startProcess(role, path.join(directory, role)));
      }
      peers = Object.fromEntries(await Promise.all(ROLES.map(async role => [role, await node(role).identity])));
      [earner, buyer] = await Promise.all([0, 1].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
      await startCoordinator();
      const opened = {};
      for (const role of ['stage0', 'stage1']) opened[role] = await node(role).call('open', nodeConfig(role));
      await node('requester').call('open', nodeConfig('requester'));
      await until(async () => (await node('requester').call('state')).ready, { timeoutMs: 30000, label: 'a ready split route', signal });
      return {
        requester: { participantId: peers.requester.participantId, computerId: 'computer-requester', preflight: await node('requester').call('weights') },
        hosts: HOSTS.map((host, index) => ({ label: host.label, stageIndex: index, participantId: peers[host.role].participantId,
          machine: 'local-process', computerId: `computer-${host.role}`, assignedLayers: opened[host.role].assignedLayers, inventory: { preflight: hostInventory(index) } }))
      };
    },
    soloControl(label) {
      const { role } = HOSTS.find(host => host.label === label);
      return node(role).call('solo', { requiredBytes: expectations.totalWeight.bytes, settings: {
        modelId: model.id, modelIdentity: model.identity, quantization: model.quantization,
        messagesDigest: expectations.workload.messagesDigest, maxOutputTokens: fixture.maxOutputTokens,
        decoding: stage1Decoding(model.generation) } });
    },
    /**
     * Whole-model control: the requester's account earns by serving another account, through the real ledger with a
     * provider-signed, consumer-countersigned receipt. The answer itself is fake here, so this shows the credit path only.
     */
    async earnCredits({ signal }) {
      const accountBefore = accountBalance('computer-requester');
      const buyerClient = createFleetClient({ url: service.url, identity: buyer }), settlements = [];
      const tokens = fixture.maxOutputTokens;
      for (let index = 0; index < EARN_REQUESTS; index++) {
        const requestId = `stage1-earn-${index}-${randomUUID()}`;
        const participant = { async generate(request, controls) {
          if (await controls.requestApproval({ requestId, recipientIdentity: earner.peerId, input: { messages: request.messages } }) !== true) throw Error('Earn control was not approved');
          const completion = { schema: 'doppler.generation-completion/v1', promptTokenCount: 4, generatedTokenCount: tokens, stopReason: 'length' };
          const output = { model: EARN_MODEL.id, modelIdentity: EARN_MODEL.identity, content: 'Earn control answer.', completion, adapterIdentities: [] };
          const measured = await measureWholeModelReceipt(request.messages, output);
          const receipt = await countersignReceipt(await signReceiptDraft(await createReceiptDraft({ ...measured,
            provider: earner.peerId, consumer: buyer.peerId, model: EARN_MODEL.id, jobHash: `request:${requestId}` }), earner), buyer);
          return { content: output.content, execution: { receipt } };
        } };
        const requester = createFleetRequester({ participant, identity: buyer, credits: buyerClient, maxOutputTokens: tokens });
        const result = await requester.generate({ model: EARN_MODEL, messages: [{ role: 'user', content: `Earn control ${index}.` }] },
          { signal, requestApproval: async () => true });
        await settled(result.serviceCredit.id, signal);
        settlements.push(await ledgerTrace(credits, result.serviceCredit.id));
      }
      return { mode: 'whole-model', modelId: EARN_MODEL.id, runtimeClass: 'fake-runtime', earner: { participantId: earner.peerId, computerId: 'computer-requester' },
        buyerComputerId: 'computer-buyer', accountBefore, settlements, accountBalanceAfter: accountBalance('computer-requester') };
    },
    async splitAnswer({ signal }) {
      const accountBefore = accountBalance('computer-requester');
      const inventoryBeforeSplit = Object.fromEntries(HOSTS.map((host, index) => [host.label, hostInventory(index)]));
      const answer = await node('requester').call('generate', { messages: fixture.messages, threadId: splitThread });
      await settled(answer.reservationId, signal);
      const [input, output] = await Promise.all(['stage0', 'stage1'].map(async role => JSON.parse(await fs.readFile(witnessFile(role), 'utf8'))));
      const { tokenIds } = await node('stage1').call('trace', { attemptId: answer.attemptId });
      const evidence = verifySplitTokens({ fixtureBytes, answer, input, output, tokenIds, roomId, threadId: splitThread,
        requesterId: peers.requester.participantId });
      return {
        workload: { modelId: answer.route.modelId, modelIdentity: answer.route.modelIdentity, quantization: answer.route.quantization,
          planIdentity: answer.route.planId, messagesDigest: credits.request(answer.reservationId).binding.inputDigest,
          promptDigest: output.promptDigest, promptCount: output.promptCount, maxOutputTokens: output.generation.maxTokens,
          decoding: stage1Decoding(output.generation) },
        split: { attemptId: answer.attemptId, text: answer.text, ...evidence, settlement: await ledgerTrace(credits, answer.reservationId),
          account: { computerId: 'computer-requester', before: accountBefore, after: accountBalance('computer-requester') },
          settlementReplay: await replay(answer.attemptId) },
        loaded: Object.fromEntries(await Promise.all(HOSTS.map(async host => [host.label, await node(host.role).call('loaded')]))),
        requesterAfterSplit: await node('requester').call('weights'),
        inventoryBeforeSplit,
        inventoryAfterSplit: Object.fromEntries(HOSTS.map((host, index) => [host.label, hostInventory(index)]))
      };
    },
    async cancelAnswer({ signal }) {
      const answer = await runGatedCancel({ requester: node('requester'), finalStage: node('stage1'), messages: fixture.messages,
        threadId: cancelThread, outputCount: expectations.reference.outputIds.length, signal });
      if (!answer.reservationId) throw Error('The stopped answer has no reservation');
      await settled(answer.reservationId, signal);
      const activity = await Promise.all(['stage0', 'stage1'].map(role => until(async () => {
        const state = await node(role).call('activity');
        return state.active === 0 && state.unsettledOwners === 0 ? state : null;
      }, { timeoutMs: 10000, label: `${role} to release the stopped attempt`, signal }).catch(() => node(role).call('activity'))));
      return { attemptId: answer.attemptId, stoppedBeforeCompletion: answer.completed === false && answer.stopped === true,
        visibleText: answer.text, residentsActive: activity.map(state => state.active + state.unsettledOwners),
        settlement: await ledgerTrace(credits, answer.reservationId), accountAfter: accountBalance('computer-requester'),
        settlementReplay: await replay(answer.attemptId) };
    },
    /**
     * Forced provider drop: SIGKILL of the first stage's process once the requester holds part of the answer. The
     * dropped hold is then released by the ledger's own expiry, one release window after the request deadline.
     */
    async dropAnswer({ signal }) {
      const accountBefore = accountBalance('computer-requester'), requester = node('requester'), killed = node('stage0');
      const drop = await runGatedDrop({ requester, killedStage: killed, messages: fixture.messages, threadId: dropThread,
        outputCount: expectations.reference.outputIds.length, signal,
        async beforeKill(attemptId) {
          // The attempt identity is known and both stages are alive: each signs its acceptance now, and the stage about
          // to be killed hands over the step receipts it holds.
          const { terms } = await requester.call('settlement-records', { attemptId });
          return { acceptances: await collectAcceptances(stageNodes(), terms), killedRecords: await killed.call('settlement-records', { attemptId }) };
        },
        async kill() {
          killed.child.kill('SIGKILL');
          await Promise.race([once(killed.child, 'exit'), delay(5000)]);
          return { host: 'host-a', how: 'SIGKILL', exited: killed.exited };
        } });
      return finishDrop({ drop, accountBefore, signal });
    },
    async cleanup() {
      await Promise.allSettled(['requester', 'stage0', 'stage1'].map(role => node(role).call('close', {}, 20000)));
      await Promise.all([...nodes.values()].map(item => item.exited ? null
        : Promise.race([once(item.child, 'exit'), delay(5000)])));
      const processesExited = [...nodes.values()].every(item => item.exited);
      const heldCredits = credits.snapshot().accounts.reduce((sum, account) => sum + account.held, 0);
      const result = { processesExited, heldCredits, openReservations: await openReservationCount(path.join(directory, 'credits.sqlite')) };
      await closeCoordinator();
      return result;
    },
    async hardStop() {
      for (const item of nodes.values()) if (!item.exited) item.child.kill('SIGKILL');
      await Promise.all([...nodes.values()].map(item => item.exited ? null : Promise.race([once(item.child, 'exit'), delay(3000)])));
      await closeCoordinator();
    }
  });

  async function closeCoordinator() {
    await Promise.resolve().then(() => service?.close()).catch(() => {});
    service = null;
    try { credits?.close(); } catch { /* already closed */ }
    credits = null;
    try { signaling?.close(); } catch { /* already closed */ }
    signaling = null;
    if (httpServer?.listening) {
      httpServer.closeAllConnections?.();
      await new Promise(resolve => httpServer.close(resolve));
    }
    httpServer = null;
  }
}
