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
import { startFleetService } from '../../server/fleet/service.js';
import { observeInventory } from './inventory.js';
import { stage1Decoding } from './expectations.js';
import { ledgerTrace, openReservationCount, runGatedCancel, until, verifySplitTokens } from './split-evidence.js';

const PROCESS_FILE = fileURLToPath(new URL('./local-process.js', import.meta.url));
const ROLES = Object.freeze(['requester', 'stage0', 'stage1']);
const HOSTS = Object.freeze([{ label: 'host-a', role: 'stage0' }, { label: 'host-b', role: 'stage1' }]);
const COMMAND_MS = 60000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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
  const splitThread = 'stage1-split-' + randomUUID(), cancelThread = 'stage1-cancel-' + randomUUID();
  const fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
  const witnessFile = role => path.join(directory, role, 'state', 'token-witness.json');
  const inventorySource = 'fake-runtime-declared';
  let credits = null, service = null, signaling = null, httpServer = null, peers = null;

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
      computers: ROLES.map(role => ({ id: `computer-${role}`, name: role, ownerId: `owner-${role}`,
        providers: [{ participantId: peers[role].participantId, publicJwk: peers[role].publicJwk }] })),
      policy: { schema: 'reploid.service-credit-policy/v1', version: 'stage1-local/1', unit: 'noncash-service-credit',
        creditsPerOutputToken: expectations.creditsPerOutputToken, maxDebt: 1000, maxOutputTokens: fixture.maxOutputTokens,
        maxPendingPerComputer: 2, maxClockSkewMs: 10000, maxRequestMs: 60000, allowSameOwner: false, wholeModelTerminalCharge: 0 } });
    service = await startFleetService({ credits, models: [{ ...model, plans: [{ id: model.partitionPlanId, creditWeights: expectations.creditWeights }] }],
      placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 } });
  }

  const nodeConfig = role => ({ modelDirectory: path.join(directory, role, 'model'), stateDirectory: path.join(directory, role, 'state'),
    signalingUrl: `ws://127.0.0.1:${httpServer.address().port}/swarm`, roomId, roomToken, serviceUrl: service.url,
    maxOutputTokens: fixture.maxOutputTokens, reference: fixture.reference,
    ...(role === 'requester' ? {} : { fakeMemoryBytes: fakeMemoryBytes[HOSTS.find(host => host.role === role).label],
      witness: { fixtureFile, fixtureSha256, receiptFile: witnessFile(role), threadId: splitThread,
        requesterId: peers.requester.participantId, stageParticipants: [peers.stage0.participantId, peers.stage1.participantId] } }) });

  const settled = (id, signal) => until(() => credits.request(id)?.state === 'settled', { timeoutMs: 20000, label: 'settlement', signal });

  return Object.freeze({
    describe: () => ({ runtimeClass: 'fake-runtime', adapter: 'local-three-process' }),
    processIds: () => [...nodes.values()].map(item => item.child.pid),
    async preflight({ signal }) {
      for (const role of ROLES) {
        await fs.mkdir(path.join(directory, role), { recursive: true, mode: 0o700 });
        nodes.set(role, startProcess(role, path.join(directory, role)));
      }
      peers = Object.fromEntries(await Promise.all(ROLES.map(async role => [role, await node(role).identity])));
      await startCoordinator();
      const opened = {};
      for (const role of ['stage0', 'stage1']) opened[role] = await node(role).call('open', nodeConfig(role));
      await node('requester').call('open', nodeConfig('requester'));
      await until(async () => (await node('requester').call('state')).ready, { timeoutMs: 30000, label: 'a ready split route', signal });
      return {
        requester: { participantId: peers.requester.participantId, preflight: await node('requester').call('weights') },
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
    async splitAnswer({ signal }) {
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
        split: { attemptId: answer.attemptId, text: answer.text, ...evidence, settlement: await ledgerTrace(credits, answer.reservationId) },
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
        settlement: await ledgerTrace(credits, answer.reservationId) };
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
