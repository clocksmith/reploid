#!/usr/bin/env node
/**
 * The combined secret-shared run, in one process and one receipt (Route 3):
 *
 *   1. earn: a device enrolled under the requester's account serves another account's whole-model answers (the
 *      north-star earn step, unchanged), so the requester spends credits it earned;
 *   2. quote: the ledger reserves the request and quotes its credit cap before anything leaves the requester;
 *   3. spend: one request through `reploid/inference` with `protection: 'secret-sharing'`, `route: 'split'`, split into stages
 *      whose projections each run on two share operators (Doppler `tools/secret-shared/`). The requester's machine holds
 *      two own-account stages (edge-in: embedding and the shares it deals; edge-out: sampling and the output chain);
 *   4. record: every share operator signs its acceptance, a stage receipt per token and a delivery record per token
 *      (its transcript digest of the shares it returned); the requester signs terms, acknowledgments and any stop;
 *   5. settle and verify: the ledger settles from the signed records, an independent replay of the same records must
 *      equal it, and `scripts/settlement/verify-trade.js` must pass. The same is done for a stop case (the requester
 *      stops mid-answer) and a failure case (one share operator dies mid-answer).
 *
 *   node scripts/secret-shared/run.js --hosts PRIVATE_FILE --work DIRECTORY --out RECEIPT_DIRECTORY
 *
 * The requester and share operators it starts are JavaScript under this Node binary: the requester (`jsRequester.script`, Doppler's JS
 * secret-shared requester) and each share operator (`operatorScript`, e.g. Doppler's `tools/secret-shared/gpu/operator-gpu.js`).
 * Reploid runs JavaScript only: the former Python requester and Go operator are refused. Until Doppler's JS requester
 * lands (branch secret-shared-2party), the host file cannot name one and the harness refuses.
 *
 * Operator processes are started per attempt and stopped after it; standing services are not touched. The receipt
 * carries no host path, SSH alias or address from the host file. A pass is not a security review, a separate-operator
 * result or a capacity claim: see `notEstablished`.
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import { createPeerIdFromPublicJwk, createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { countersignReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { createAttemptEvidenceSigner, openStageReceipts, openOutputAcknowledgments, MAX_UNACKNOWLEDGED_OUTPUTS }
  from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { PARTITION_ROUTE_SCHEMA, ROUTE_ATTEMPT_SCHEMA } from '../../packages/reploid/src/contracts/partition.js';
import { acceptSettlementTerms, signSettlementStop, signSettlementTerms, policyDigest } from '../../server/fleet/settlement-terms.js';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { fleetCreditQuote } from '../../server/fleet/contract.js';
import { createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { createInference, createSecretSharedExecution, SECRET_SHARED_BACKEND, describeDisclosure } from '../../packages/reploid/src/inference/index.js';
import { SECRET_SHARED_PROTOCOL } from '../../packages/reploid/src/chat/execution-policy.js';
import { ledgerTrace, openReservationCount } from '../stage1/split-evidence.js';
import { startPhysicalCoordinator } from '../stage1/physical-coordinator.js';
import { openAgentSession, createSshTransport } from '../stage1/command-transport.js';
import { harnessDigest, readHostIdentity } from '../stage1/host-agent.js';
import { verifyTrade } from '../settlement/verify-trade.js';

export const SECRET_SHARED_HOSTS_SCHEMA = 'reploid.secret-shared-hosts/v1';
export const SECRET_SHARED_RECEIPT_SCHEMA = 'reploid.secret-shared-receipt/v1';
const EARN_MAX_REQUESTS = 6;
const JS_SCRIPT = /\.m?js$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A JSON-lines session with a share agent: `call(op, body)`. */
function agentSession(command, { log = () => {} } = {}) {
  const child = spawn(command[0], command.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let next = 1, closed = false;
  const hello = new Promise((resolve, reject) => {
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.event === 'agent') { resolve(message); return; }
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(Error(message.error)); else waiter.resolve(message.result);
    });
    child.once('exit', code => { closed = true; reject(Error(`agent exited ${code}`)); for (const waiter of pending.values()) waiter.reject(Error(`agent exited ${code}`)); });
  });
  readline.createInterface({ input: child.stderr }).on('line', line => { if (!/post-quantum|store now|upgraded|pq.html|Pseudo-terminal/.test(line)) log(`agent: ${line.slice(0, 300)}`); });
  hello.catch(() => {});
  return {
    hello,
    call(op, body = {}, timeoutMs = 120000) {
      if (closed) return Promise.reject(Error('agent session closed'));
      const id = next++;
      child.stdin.write(JSON.stringify({ id, op, body }) + '\n');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`${op} timed out`)); }, timeoutMs);
        pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      });
    },
    /** Ends the session; resolves once the agent (and any tunnel its command opened) has exited. */
    end() {
      if (closed || child.exitCode !== null) return Promise.resolve();
      const exited = new Promise(resolve => child.once('exit', resolve));
      try { child.stdin.write(JSON.stringify({ id: 0, op: 'exit' }) + '\n'); } catch { /* gone */ }
      setTimeout(() => child.kill(), 3000).unref();
      return exited;
    }
  };
}

/** Removes every host-file string that could name a machine, path, alias or address, and every run secret. */
function createRedactor(config) {
  const secrets = new Set();
  const collect = value => {
    if (typeof value === 'string') { if (value.length >= 4 && (value.includes('/') || value.includes('\\') || /\d+\.\d+\.\d+\.\d+/.test(value) || /[A-Za-z]/.test(value))) secrets.add(value); return; }
    if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => {
      if (!['schema', 'label', 'machineId', 'participantId', 'role', 'modelId', 'weights', 'name', 'prompt', 'stage', 'share'].includes(key)) collect(item);
    });
  };
  collect({ requester: config.requester, operators: config.operators, jsRequester: config.jsRequester, coordinator: config.coordinator, earner: config.earner });
  for (const home of ['/Users/', '/home/', '/mnt/', 'C:\\Users\\']) secrets.add(home);
  const ordered = () => [...secrets].sort((a, b) => b.length - a.length);
  const text = value => ordered().reduce((out, secret) => out.split(secret).join('<redacted>'), String(value));
  return { add: value => { if (typeof value === 'string' && value) secrets.add(value); }, text, receipt: value => JSON.parse(text(JSON.stringify(value))) };
}

export function validateSecretSharedConfig(config) {
  const refuse = message => { throw Error(`secret-shared-config: ${message}`); };
  if (config?.schema !== SECRET_SHARED_HOSTS_SCHEMA) refuse('schema');
  if (config.python !== undefined) refuse('python: the Python requester was removed (Reploid runs JavaScript only); name Doppler\'s JS requester in jsRequester.script');
  if (!JS_SCRIPT.test(config.jsRequester?.script ?? '') || typeof config.jsRequester?.model !== 'string') {
    refuse('jsRequester: needs { script, model } with a .js/.mjs script; Doppler\'s JS secret-shared requester (branch secret-shared-2party) has not landed, so this harness refuses until it does');
  }
  if (!Array.isArray(config.operators) || config.operators.length < 2) refuse('operators');
  const stages = new Map();
  for (const op of config.operators) {
    for (const key of ['label', 'machineId', 'stage', 'share', 'agent', 'identityFile', 'operatorScript', 'modelDirectory', 'listen', 'endpoint', 'workDirectory']) if (op[key] === undefined) refuse(`operator.${key}`);
    if (!JS_SCRIPT.test(op.operatorScript)) refuse(`operator.operatorScript: ${op.label} must be a JavaScript operator (.js/.mjs); the Go operator is refused`);
    stages.set(op.stage, [...(stages.get(op.stage) ?? []), op]);
  }
  for (const [stage, pair] of stages) {
    if (pair.length !== 2 || pair.map(op => op.share).sort().join() !== '0,1') refuse(`stage ${stage} needs share 0 and share 1`);
    if (pair[0].machineId === pair[1].machineId) refuse(`stage ${stage}: both shares on one machine`);
    if (pair.some(op => op.machineId === config.requester.machineId)) refuse(`stage ${stage}: a share operator on the requester's machine`);
  }
  if (config.credit?.weights?.length !== config.operators.length + 2) refuse('credit.weights: edge-in, each share in stage order, edge-out');
  return config;
}

export async function runSecretShared({ config, directory, log = () => {}, now = Date.now, transport = createSshTransport() }) {
  validateSecretSharedConfig(config);
  await fs.access(config.jsRequester.script).catch(() => { throw Error('secret-shared-config: jsRequester.script does not exist; Doppler\'s JS requester has not landed'); });
  const redactor = createRedactor(config);
  const stamp = () => new Date(now()).toISOString();
  const steps = [];
  const step = async (name, work) => {
    const started = now();
    log(`${stamp()} ${name} start`);
    try { const value = await work(); steps.push({ name, startedAt: new Date(started).toISOString(), ms: now() - started, ok: true }); return value; }
    catch (error) { steps.push({ name, startedAt: new Date(started).toISOString(), ms: now() - started, ok: false, error: redactor.text(error?.message ?? error) }); throw error; }
  };
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const model = catalog.find(row => row.id === config.modelId);
  if (!model) throw Error('modelId is not in the catalog');
  const planBytes = await fs.readFile(config.plan);
  const plan = JSON.parse(planBytes);
  if (plan.modelId !== model.id) throw Error('The secret-shared plan is for another model');
  const planId = 'sha256:' + sha256(planBytes);
  const operators = [...config.operators].sort((a, b) => a.stage - b.stage || a.share - b.share);
  const stageCount = new Set(operators.map(op => op.stage)).size;
  if (stageCount !== plan.stages.length) throw Error('The host file and the plan name different stage counts');

  // Requester-side identities: the requester, and its own edge stages.
  const requester = await readHostIdentity(config.requester.identityFile);
  const edgeIn = await readHostIdentity(config.requester.edgeInIdentityFile);
  const edgeOut = await readHostIdentity(config.requester.edgeOutIdentityFile);
  const signers = { requester: createAttemptEvidenceSigner({ identity: requester, now }), edgeIn: createAttemptEvidenceSigner({ identity: edgeIn, now }),
    edgeOut: createAttemptEvidenceSigner({ identity: edgeOut, now }) };

  // Each operator proves its identity once, from its own host.
  const proven = [];
  for (const op of operators) {
    const session = agentSession(op.agent, { log: line => log(`${op.label} ${redactor.text(line)}`) });
    await session.hello;
    const proved = await session.call('identity', { file: op.identityFile });
    if (await createPeerIdFromPublicJwk(proved.publicJwk) !== proved.participantId) throw Error(`${op.label} proved a malformed identity`);
    proven.push({ ...op, participantId: proved.participantId, publicJwk: proved.publicJwk });
    await session.end();
  }
  const participants = { requester: { participantId: requester.peerId, publicJwk: requester.publicJwk },
    edgeIn: { participantId: edgeIn.peerId, publicJwk: edgeIn.publicJwk }, edgeOut: { participantId: edgeOut.peerId, publicJwk: edgeOut.publicJwk } };

  const receipt = { schema: SECRET_SHARED_RECEIPT_SCHEMA, startedAt: stamp(), finishedAt: null,
    release: { sha: (await fs.readFile(new URL('../../RELEASE_SHA', import.meta.url), 'utf8').catch(() => '')).trim() || null },
    workload: { modelId: model.id, modelIdentity: model.identity, planId, planSchema: plan.schema, fixedPoint: { ring: 'Z_2^64', fx: plan.fx, fw: plan.fw },
      stages: plan.stages.map(stage => ({ index: stage.index, layers: stage.layers, groups: stage.groups.length,
        tensorDigests: 'sha256:' + sha256(JSON.stringify(stage.groups.flatMap(group => group.tensors.map(t => [t.name, t.sha256])))) })) },
    participants: null, requester: null, hosts: null, earn: null, quote: null, split: null, stop: null, failure: null,
    privacy: null, cost: null, cleanup: null, steps, error: null, verdict: null };

  const buyer = config.earner ? await createSigningIdentity({ algorithm: 'Ed25519' }) : null;
  const accounts = [{ label: 'requester', participants: [participants.requester, participants.edgeIn, participants.edgeOut] },
    ...proven.map(op => ({ label: op.label, participants: [{ participantId: op.participantId, publicJwk: op.publicJwk }] }))];
  let earner = null, coordinator = null, credits = null, ledgerFile = null;
  const sessions = [];
  try {
    if (config.earner) {
      // The north-star earn step: the earner proves its identity through the Stage 1 host agent on its own machine.
      const agent = target => [target.node, `${target.releaseRoot}/scripts/stage1/host-agent.js`, '--session'];
      earner = openAgentSession(transport.open(config.earner, agent(config.earner)), { defaultTimeoutMs: config.limits?.phaseMs ?? 900000 });
      sessions.push(earner);
      await earner.hello;
      receipt.earnerHarness = { digest: earner.harnessDigest, local: await harnessDigest() };
      if (earner.harnessDigest !== receipt.earnerHarness.local) throw Error('The earner runs other Stage 1 harness code');
      const proved = await earner.call('identity', { file: config.earner.identityFile });
      if (proved.participantId !== config.earner.participantId) throw Error('The earner proved another identity');
      accounts[0].participants.push({ participantId: proved.participantId, publicJwk: proved.publicJwk });
      accounts.push({ label: 'buyer', participants: [{ participantId: buyer.peerId, publicJwk: buyer.publicJwk }] });
      const earnModel = catalog.find(row => row.id === config.earner.modelId);
      coordinator = await step('start coordinator', () => startPhysicalCoordinator({ config: { coordinator: config.coordinator, credit: { ...config.credit, weights: [1, 1] } },
        peers: {}, directory, model: { id: model.id, identity: model.identity, partitionPlanId: planId }, fixture: { maxOutputTokens: config.credit.maxOutputTokens },
        expectations: { creditsPerOutputToken: 1 }, computers: accounts, allowSameOwner: true, roomPrefix: 'reploid-swarm-secret-shared-', onSecret: value => redactor.add(value),
        earnModel: { id: earnModel.id, identity: earnModel.identity } }));
      redactor.add(coordinator.serviceUrl); redactor.add(coordinator.signalingUrl);
      credits = coordinator.credits; ledgerFile = coordinator.ledgerFile;
    } else {
      ledgerFile = path.join(directory, 'credits.sqlite');
      credits = await openFleetCredits({ file: ledgerFile, computers: accounts.map(({ label, participants: list }) => ({ id: `computer-${label}`, name: label, ownerId: `owner-${label}`, providers: list })),
        policy: { schema: 'reploid.service-credit-policy/v1', version: 'secret-shared/1', unit: 'noncash-service-credit', creditsPerOutputToken: 1,
          maxDebt: config.credit.maxDebt, maxOutputTokens: config.credit.maxOutputTokens, maxPendingPerComputer: 2, maxClockSkewMs: 30000,
          maxRequestMs: config.credit.maxRequestMs, allowSameOwner: true, wholeModelTerminalCharge: 0, partitionUnclaimedReleaseMs: config.credit.partitionUnclaimedReleaseMs } });
    }
    const accountOf = id => credits.enrollment.byPeer.get(id)?.computerId ?? id;
    const balance = computerId => credits.snapshot().accounts.find(row => row.computerIds.includes(computerId))?.balance ?? null;
    receipt.participants = { accounts: accounts.map(account => ({ accountId: `owner-${account.label}`, participants: account.participants.map(row => row.participantId) })),
      requester: { participantId: requester.peerId, machineId: config.requester.machineId, edgeIn: edgeIn.peerId, edgeOut: edgeOut.peerId },
      operators: proven.map(op => ({ label: op.label, machineId: op.machineId, stage: op.stage, share: op.share === 0 ? 'A' : 'B', participantId: op.participantId, account: `owner-${op.label}` })),
      sameOwner: 'One person owns every machine; the accounts are separate ledger accounts, not independent operators.' };
    receipt.requester = { participantId: requester.peerId, computerId: 'computer-requester' };
    receipt.hosts = [{ label: 'edge-in', participantId: edgeIn.peerId, computerId: 'computer-requester' },
      ...proven.map(op => ({ label: op.label, participantId: op.participantId, computerId: `computer-${op.label}` })),
      { label: 'edge-out', participantId: edgeOut.peerId, computerId: 'computer-requester' }];

    // 1. Earn (north-star step, unchanged).
    if (config.earner) {
      await step('earn open whole model', () => earner.call('open-whole', { modelId: config.earner.modelId, modelDirectory: config.earner.modelDirectory }));
      const accountId = 'computer-requester', before = balance(accountId), settlements = [];
      const client = createFleetClient({ url: coordinator.serviceUrl, identity: buyer, ...(coordinator.serviceCa ? { ca: coordinator.serviceCa } : {}) });
      const earnModel = catalog.find(row => row.id === config.earner.modelId);
      const target = 2 * config.credit.maxOutputTokens;
      for (let index = 0; index < EARN_MAX_REQUESTS && (balance(accountId) ?? 0) < target; index++) {
        const requestId = `secret-shared-earn-${index}-${randomUUID()}`;
        const participant = { async generate(request, controls) {
          if (await controls.requestApproval({ requestId, recipientIdentity: config.earner.participantId, input: { messages: request.messages } }) !== true) throw Error('Earn request not approved');
          const served = await earner.call('serve-whole', { requestId, consumer: buyer.peerId, messages: request.messages, settings: request.settings, timeoutMs: 600000 }, { timeoutMs: 605000 });
          return { content: served.content, execution: { receipt: await countersignReceipt(served.receipt, buyer) } };
        } };
        const fleet = createFleetRequester({ participant, identity: buyer, credits: client, maxOutputTokens: config.credit.maxOutputTokens });
        await step(`earn request ${index}`, async () => {
          const result = await fleet.generate({ model: { id: earnModel.id, identity: earnModel.identity }, messages: [{ role: 'user', content: `Write a short paragraph about tide pools, request ${index}.` }],
            settings: { maxOutputTokens: config.credit.maxOutputTokens } }, { signal: new AbortController().signal, requestApproval: async () => true });
          for (let wait = 0; credits.request(result.serviceCredit.id)?.state !== 'settled' && wait < 600; wait++) await delay(250);
          settlements.push(await ledgerTrace(credits, result.serviceCredit.id));
        });
      }
      await step('earn close whole model', () => earner.call('close'));
      receipt.earn = { mode: 'whole-model', modelId: config.earner.modelId, earner: config.earner.participantId, accountId, buyerAccountId: 'computer-buyer',
        accountBefore: before, settlements, accountAfter: balance(accountId) };
    }

    // 2-5. One attempt per case, each through reploid/inference with protection 'secret-sharing'.
    const runCase = async kase => {
      const attemptId = `ss-${kase.name}-${randomUUID()}`, reservationId = `secret-shared-${kase.name}-${randomUUID()}`, threadId = `ss-thread-${randomUUID()}`;
      const token = randomBytes(16).toString('hex');
      redactor.add(token);
      const stageIds = [edgeIn.peerId, ...proven.map(op => op.participantId), edgeOut.peerId];
      const identity = { schema: ROUTE_ATTEMPT_SCHEMA, threadId, attemptId, requesterId: requester.peerId, placementGeneration: 0,
        route: { schema: PARTITION_ROUTE_SCHEMA, modelId: model.id, modelIdentity: model.identity, planId,
          stages: stageIds.map((participantId, index) => ({ index, participantId, transportId: `ss-link-${index}`, residentId: `ss-${index}`, executionId: `${attemptId}:${index}` })),
          activation: { schema: 'doppler.activation-tensor/v1', dtype: 'f32', hiddenSize: config.hiddenSize, precision: 'f32', components: 1, elementStrideBytes: 4 } } };
      const weights = config.credit.weights;
      const messages = [{ role: 'user', content: kase.prompt }];
      const record = { case: kase.name, attemptId, reservationId, prompt: kase.prompt, maxOutputTokens: kase.maxTokens, events: [], tokens: [], text: '', streamed: '' };
      const agents = [], held = { terms: null, acceptances: [], acks: [], stop: null, edge: { in: [], out: [] } };
      let edgeInReceipts = null, edgeOutReceipts = null, acks = null, requesterChild = null, beforeBalance = null;

      const secretShared = createSecretSharedExecution({
        resolve: async () => ({ route: { id: `ss-route-${planId.slice(7, 23)}`, shape: 'split', selection: 'all', backend: SECRET_SHARED_BACKEND, protocol: SECRET_SHARED_PROTOCOL,
          model: { id: model.id, identity: model.identity, adapterIdentities: [] }, planIdentity: planId, participants: proven.map(op => op.participantId).sort(),
          secretShared: { stages: plan.stages.map(stage => ({ index: stage.index, layers: stage.layers,
            shares: [0, 1].map(share => proven.find(op => op.stage === stage.index && op.share === share).participantId) })),
          fixedPoint: { ring: 'Z_2^64', fx: plan.fx, fw: plan.fw }, requesterHolds: ['embedding', 'norm weights', 'DeltaNet convolution, A_log, dt_bias', 'KV and recurrent state', 'sampling'] } },
        maxCharge: { kind: 'capped', unit: credits.policy.unit, maximum: kase.maxTokens * credits.policy.creditsPerOutputToken } }),
        async execute({ signal, onAdmitted, onDelta }) {
          // Quote and hold the cap before any input leaves this machine.
          const quote = fleetCreditQuote(credits.policy, kase.maxTokens, 'partition');
          beforeBalance = balance('computer-requester');
          const binding = credits.reserve({ id: reservationId, executionId: attemptId, consumer: requester.peerId, mode: 'partition',
            model: { id: model.id, identity: model.identity, adapterIdentities: [] }, inputDigest: 'sha256:' + sha256(JSON.stringify(messages)),
            maxOutputTokens: kase.maxTokens, providers: stageIds.map((participantId, index) => ({ participantId, weight: weights[index] })), route: identity, acceptedQuote: quote });
          record.quote = { quotedBeforeDispatch: structuredClone(quote), hold: binding.maximum, at: stamp(), balanceBefore: beforeBalance };
          try { await prepareStages(binding); }
          catch (error) {
            // Nothing left this machine yet: release the hold rather than strand it.
            credits.abandonBeforeDispatch(reservationId, requester.peerId);
            record.abandonedBeforeDispatch = { at: stamp(), error: redactor.text(error?.message ?? error) };
            throw error;
          }
          credits.dispatch(reservationId, requester.peerId);
          return runRequester({ signal, onAdmitted, onDelta });
        }
      });
      async function prepareStages(binding) {
          held.terms = await signSettlementTerms({ signer: signers.requester, identity, reservationId, policy: credits.policy, maxOutputTokens: kase.maxTokens, weights,
            notBefore: binding.createdAt, deadline: binding.deadline, maxUnacknowledgedOutputs: credits.policy.maxUnacknowledgedOutputs ?? MAX_UNACKNOWLEDGED_OUTPUTS });
          // Every stage accepts the exact terms at its own index before any share is sent.
          held.acceptances.push(await acceptSettlementTerms({ signer: signers.edgeIn, terms: held.terms, partitionIndex: 0 }));
          for (const [index, op] of proven.entries()) {
            const session = agentSession(op.agent, { log: line => log(`${op.label} ${redactor.text(line)}`) });
            agents.push(session);
            await session.hello;
            await session.call('identity', { file: op.identityFile });
            await session.call('open', { operatorScript: op.operatorScript, plan: planBytes.toString('utf8'), modelDirectory: op.modelDirectory, stage: op.stage, share: op.share,
              listen: op.listen, threads: op.threads ?? 0, token, workDirectory: op.workDirectory });
            held.acceptances.push(await session.call('accept', { terms: held.terms, partitionIndex: index + 1 }));
          }
          held.acceptances.push(await acceptSettlementTerms({ signer: signers.edgeOut, terms: held.terms, partitionIndex: stageIds.length - 1 }));
      }
      async function runRequester({ signal, onAdmitted, onDelta }) {
          acks = await openOutputAcknowledgments({ signer: signers.requester, identity, reservationId, textlessOutputs: true });
          held.acks.push(acks.charge);
          edgeInReceipts = await openStageReceipts({ signer: signers.edgeIn, identity, partitionIndex: 0, charge: acks.charge, textlessOutputs: true });
          edgeOutReceipts = await openStageReceipts({ signer: signers.edgeOut, identity, partitionIndex: stageIds.length - 1, charge: acks.charge, textlessOutputs: true });
          await Promise.all(agents.map((session, index) => session.call('charge', { identity, partitionIndex: index + 1, charge: acks.charge, stage: proven[index].stage, share: proven[index].share })));
          onAdmitted({ bindingDigest: 'sha256:' + sha256(JSON.stringify({ identity, terms: held.terms.signature })) });

          // The requester process: shares, dispatch to the operators over their own links, reconstruction, sampling.
          const work = path.join(directory, kase.name);
          await fs.mkdir(work, { recursive: true });
          const opsFile = path.join(work, 'operators.json'), requestFile = path.join(work, 'request.json'), reportFile = path.join(work, 'requester-report.json');
          await fs.writeFile(opsFile, JSON.stringify({ token, stages: plan.stages.map(stage => [0, 1].map(share => proven.find(op => op.stage === stage.index && op.share === share).endpoint)) }), { mode: 0o600 });
          await fs.writeFile(requestFile, JSON.stringify({ messages, maxTokens: kase.maxTokens }));
          requesterChild = spawn(process.execPath, [config.jsRequester.script, 'run', '--model', config.jsRequester.model, '--plan', config.plan,
            '--operators', opsFile, '--request', requestFile, '--out', reportFile, '--threads', String(config.jsRequester.threads ?? 4)], { stdio: ['pipe', 'pipe', 'pipe'] });
          const stderr = [];
          readline.createInterface({ input: requesterChild.stderr }).on('line', line => { if (stderr.length < 50 && !/fast path/.test(line)) stderr.push(line.slice(0, 300)); });
          signal.addEventListener('abort', () => requesterChild.stdin.write('stop\n'), { once: true });
          let ended = null, failed = null, stopSent = false;
          for await (const line of readline.createInterface({ input: requesterChild.stdout })) {
            const event = JSON.parse(line);
            record.events.push({ at: stamp(), ...Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'delta')) });
            if (event.event === 'token') {
              held.edge.in.push(await edgeInReceipts.step({ step: event.step, inputTokenCount: event.inputTokens }));
              const out = await edgeOutReceipts.step({ step: event.step, inputTokenCount: event.inputTokens, delta: event.delta, done: event.done, stopReason: event.stopReason });
              held.edge.out.push(out);
              const isStopped = held.stop !== null;
              if (!isStopped) {
                const pair = await acks.observe({ step: event.step, delta: event.delta, receipt: out });
                if (pair) {
                  held.acks.push(pair.acknowledgment);
                  await edgeInReceipts.acknowledge(pair); await edgeOutReceipts.acknowledge(pair);
                  await Promise.all(agents.map(session => session.call('ack', { acknowledged: pair }).catch(() => null)));
                }
              }
              record.tokens.push(event.tokenId); record.text += event.delta;
              // An output delivered after the requester's stop is neither acknowledged nor part of the answer.
              if (!isStopped) { record.streamed += event.delta; onDelta(event.delta); }
              if (kase.stopAfter && record.tokens.length === kase.stopAfter && !stopSent) {
                // The requester signs its stop at its acknowledged count before it tells anyone to stop.
                held.stop = await signSettlementStop({ signer: signers.requester, terms: held.terms, acknowledged: acks.state().count });
                requesterChild.stdin.write('stop\n'); stopSent = true;
              }
              if (kase.killOperator && record.tokens.length === kase.afterTokens) {
                const victim = proven.findIndex(op => op.label === kase.killOperator);
                record.injected = { at: stamp(), operator: kase.killOperator, afterTokens: kase.afterTokens, result: await agents[victim].call('kill') };
              }
            } else if (event.event === 'ready') record.promptTokens = event.promptTokens;
            else if (event.event === 'end') ended = event;
            else if (event.event === 'failed') failed = event;
          }
          await new Promise(resolve => requesterChild.exitCode !== null ? resolve() : requesterChild.once('exit', resolve));
          record.requesterStderr = stderr.slice(-10);
          record.requesterReport = JSON.parse(await fs.readFile(reportFile, 'utf8').catch(() => 'null'));
          if (failed || !ended) throw Object.assign(Error(`the secret-shared requester failed: ${failed?.error ?? 'no end event'}`), { secretShared: { freshness: null } });
          return { text: record.streamed, stopReason: ended.stopReason, usage: { inputTokens: record.promptTokens, outputTokens: record.tokens.length },
            settlement: { reservationId }, evidence: { freshness: ended.freshness,
              transport: config.transport ?? 'each requester-operator link is its own encrypted channel (SSH or WireGuard)' } };
      }
      const inference = createInference({ resolveRoute: async () => { throw Error('readable routes are not used here'); }, execute: async () => { throw Error('unused'); },
        secretSharedExecution: secretShared, unreviewedSecretSharedExecution: true });
      const prepared = await inference.prepare({ model: { id: model.id, identity: model.identity }, generation: { maxOutputTokens: kase.maxTokens },
        execution: { protection: 'secret-sharing', route: 'split',
          participants: { kind: 'named', ids: proven.map(op => op.participantId) }, allowMetadata: ['model-id', 'timing', 'length'] } });
      record.disclosure = prepared.disclosure;
      record.maxCharge = prepared.maxCharge;
      const run = await inference.run({ planId: prepared.id, requestId: `req-${attemptId}`, input: { messages } }, { attemptId });
      const result = await run.result;
      record.result = { status: result.status, output: result.output, usage: result.usage, error: result.error ?? null };
      record.executionReceipt = result.executionReceipt;

      // Close every stage: the edges here, each share operator on its own host (a dead operator closes failed).
      const attemptFailed = result.status === 'failed';
      record.closing = await Promise.all(agents.map((session, index) => session.call('close', { failed: attemptFailed }).then(row => ({ label: proven[index].label, died: row.died,
        operatorExit: row.operatorExit, status: row.receipt?.status ?? null })).catch(error => ({ label: proven[index].label, error: String(error?.message ?? error) }))));
      const closingIn = edgeInReceipts ? await edgeInReceipts.close({ failed: attemptFailed }) : null;
      const closingOut = edgeOutReceipts ? await edgeOutReceipts.close({ failed: attemptFailed }) : null;
      const agentRecords = await Promise.all(agents.map(session => session.call('records').catch(error => ({ records: [], deliveries: [], log: [{ error: String(error?.message ?? error) }] }))));
      await Promise.all(agents.map(session => session.end()));
      record.deliveries = agentRecords.map((row, index) => ({ label: proven[index].label, stage: proven[index].stage, share: proven[index].share === 0 ? 'A' : 'B',
        participantId: proven[index].participantId, records: row.deliveries, log: row.log.slice(-20) }));

      // Settle from the signed records, as the ledger would from the stages.
      const lastOf = list => list.filter(Boolean).at(-1) ?? null;
      const closingReceipts = [closingIn, ...agentRecords.map(row => lastOf(row.records.filter(item => item.schema === 'reploid.stage-receipt/v1'))), closingOut].filter(Boolean);
      const latest = acks?.state().acknowledged ?? null;
      const evidence = { identity, receipts: closingReceipts, acknowledgment: latest?.acknowledgment ?? acks?.charge ?? null,
        ...(latest ? { acknowledgedReceipt: latest.receipt } : {}), ...(held.stop ? { stop: held.stop } : {}) };
      try { await credits.settle(reservationId, evidence); record.settleError = null; }
      catch (error) { record.settleError = String(error?.message ?? error); }
      record.settlement = await ledgerTrace(credits, reservationId);
      const records = [held.terms, ...held.acceptances, ...(held.stop ? [held.stop] : []), ...held.acks, ...held.edge.in.filter(Boolean), ...held.edge.out.filter(Boolean),
        closingIn, closingOut, ...agentRecords.flatMap(row => row.records.filter(item => item.schema !== 'reploid.settlement-acceptance/v1'))].filter(Boolean);
      const unique = [...new Map(records.map(item => [JSON.stringify(item), item])).values()];
      const replay = await replaySettlement({ records: unique, policies: [credits.policy], at: now(), accountOf });
      record.settlementReplay = { policy: structuredClone(credits.policy), ledgerPolicyDigest: await policyDigest(credits.policy), recordCount: unique.length, records: unique, result: replay };
      record.account = { accountId: 'computer-requester', before: beforeBalance, after: balance('computer-requester') };
      return record;
    };

    const cases = config.cases ?? [{ name: 'split', prompt: 'Explain why the sky is blue in one sentence.', maxTokens: 32 }];
    for (const kase of cases) {
      const key = kase.name === 'split' ? 'split' : kase.name === 'stop' ? 'stop' : 'failure';
      receipt[key] = await step(`case ${kase.name}`, () => runCase(kase));
    }
    receipt.quote = receipt.split?.quote ?? null;
    receipt.privacy = privacyStatement(receipt.split ?? receipt.stop, proven);
    receipt.cost = costSummary(receipt.split);
    receipt.cleanup = { heldCredits: credits.snapshot().accounts.reduce((sum, row) => sum + row.held, 0), openReservations: await openReservationCount(ledgerFile) };
  } catch (error) {
    receipt.error = redactor.text(error?.stack ?? error?.message ?? error);
  } finally {
    for (const session of sessions) { try { session.end(); } catch { /* ended */ } }
    if (coordinator) await coordinator.close().catch(() => {}); else try { credits?.close?.(); } catch { /* closed */ }
    receipt.finishedAt = stamp();
  }
  receipt.notEstablished = [
    'An independent security review of the secret-shared tier.',
    'Non-collusion: one person owns every machine, so the two share operators of each stage are separate accounts, not independent operators.',
    'Malicious security: an operator that returns wrong shares corrupts the answer undetected (no Freivalds check yet).',
    'Capacity beyond one machine: the 0.8B fits on one machine; this run shows the protocol, not capacity.',
    'Outsider reproduction on another machine: the verify-trade kit ran here.'];
  return redactor.receipt(receipt);
}

/** Who could read what on this run, per party and per coalition, in the receipt's words. */
function privacyStatement(attempt, proven) {
  if (!attempt) return null;
  const freshness = attempt.executionReceipt?.evidence?.privacy?.checks?.find(row => row.claim === 'fresh-shares-every-round')?.value ?? null;
  return { protection: 'secret-sharing', routeKind: attempt.executionReceipt?.routeKind ?? null, assumption: 'non-colluding-share-pairs',
    statement: attempt.disclosure ? describeDisclosure(attempt.disclosure) : null,
    freshShares: freshness,
    whoCouldRead: [
      { who: 'requester machine (requester, edge-in, edge-out)', reads: 'prompt, answer, token IDs and every activation: it is the data owner and evaluates every nonlinear step' },
      ...proven.map(op => ({ who: `${op.label} (stage ${op.stage}, share ${op.share === 0 ? 'A' : 'B'})`, reads: 'fresh random shares of its stage\'s projection inputs, its own output shares, the public weights of its stage, the prompt length, the number of generated tokens, timing and sizes; never token IDs, text or plaintext activations' })),
      { who: 'ledger and signaling', reads: 'identities, model, stage plan, timing, sizes and signed settlement and delivery records; no shares, no content' },
      { who: 'network observer', reads: 'sizes and timing of encrypted links' }],
    coalitions: [
      ...[...new Set(proven.map(op => op.stage))].map(stage => ({ together: proven.filter(op => op.stage === stage).map(op => op.label),
        learn: `the hidden states, projections and MLP activations of stage ${stage}, from which content can be reconstructed (the broken assumption)` })),
      { together: 'operators of different stages, or any operator with the ledger', learn: 'nothing more: shares are fresh every round and never combine across stages' }],
    wire: 'Each operator request carries only { op, group, n, round, step, seeded } and a share payload; no token ID, text or plaintext tensor is ever sent to an operator.' };
}

function costSummary(attempt) {
  const events = attempt?.events?.filter(event => event.event === 'token') ?? [];
  if (!events.length) return null;
  const decode = events.slice(1);
  const median = list => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
  const report = attempt.requesterReport;
  return { prefill: { promptTokens: attempt.promptTokens, wallMs: events[0].wallMs, cpuMs: events[0].cpuMs, rounds: events[0].rounds, upBytes: events[0].up, downBytes: events[0].down },
    decodePerToken: { tokens: decode.length, medianWallMs: median(decode.map(e => e.wallMs)), medianRequesterCpuMs: median(decode.map(e => e.cpuMs)),
      rounds: median(decode.map(e => e.rounds)), medianUpBytes: median(decode.map(e => e.up)), medianDownBytes: median(decode.map(e => e.down)),
      medianWireMs: median(decode.map(e => e.wireMs)), medianOperatorMs: median(decode.map(e => e.operatorMs)) },
    requesterPeakRss: report?.requesterPeakRss ?? null,
    operators: report?.operatorStats ?? null };
}

/** The outcome: every attempt verifies by the outsider kit, the split answer matches, nothing is held. */
export async function checkSecretShared(receipt, { expectedTokens = null } = {}) {
  const problems = [];
  const fail = (code, detail) => problems.push({ code, detail: String(detail) });
  if (receipt.error) fail('run-error', receipt.error);
  if (receipt.earn && !(receipt.earn.accountAfter > receipt.earn.accountBefore)) fail('earn', 'the account did not earn');
  for (const key of ['split', 'stop', 'failure']) {
    const attempt = receipt[key];
    if (!attempt) { fail('missing-case', key); continue; }
    if (!attempt.quote?.quotedBeforeDispatch) fail('no-quote', key);
    if (attempt.settleError && key === 'split') fail('settle', attempt.settleError);
  }
  if (receipt.split?.result?.status !== 'completed') fail('split-status', receipt.split?.result?.status);
  if (expectedTokens && JSON.stringify(receipt.split?.tokens) !== JSON.stringify(expectedTokens)) fail('tokens', 'the split answer differs from the reference tokens');
  if (receipt.stop && receipt.stop.result?.status !== 'cancelled') fail('stop-status', receipt.stop.result?.status);
  if (receipt.failure && receipt.failure.result?.status !== 'failed') fail('failure-status', receipt.failure.result?.status);
  const fresh = receipt.privacy?.freshShares;
  if (!fresh || fresh.rounds !== fresh.distinctShareBDigests || !fresh.countersStrictlyIncreasing) fail('fresh-shares', JSON.stringify(fresh));
  const verdict = await verifyTrade({ receipt });
  for (const row of verdict.attempts) if (!row.ok) fail(`verify-trade-${row.name}`, row.problems.join('; '));
  if (receipt.cleanup && (receipt.cleanup.heldCredits !== 0 || receipt.cleanup.openReservations !== 0)) fail('stranded-hold', JSON.stringify(receipt.cleanup));
  return { passed: problems.length === 0, problems, verifyTrade: verdict };
}

async function main() {
  const { values } = parseArgs({ options: { hosts: { type: 'string' }, work: { type: 'string' }, out: { type: 'string' }, reference: { type: 'string' } } });
  if (!values.hosts || !values.work || !values.out) throw Error('Usage: run.js --hosts PRIVATE_FILE --work DIRECTORY --out RECEIPT_DIRECTORY [--reference TOKENS.json]');
  const config = JSON.parse(await fs.readFile(values.hosts, 'utf8'));
  const receipt = await runSecretShared({ config, directory: path.resolve(values.work), log: line => process.stderr.write(line + '\n') });
  const expectedTokens = values.reference ? JSON.parse(await fs.readFile(values.reference, 'utf8')).tokens : null;
  receipt.verdict = await checkSecretShared(receipt, { expectedTokens });
  await fs.mkdir(values.out, { recursive: true });
  await fs.writeFile(path.join(values.out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  process.stderr.write(`verdict: ${receipt.verdict.passed ? 'passed' : 'failed'}${receipt.verdict.problems.map(row => `\n  ${row.code}: ${row.detail}`).join('')}\n`);
  if (!receipt.verdict.passed) process.exitCode = 1;
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) {
  try { await main(); } catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; }
}
