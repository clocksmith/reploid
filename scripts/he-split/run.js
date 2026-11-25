#!/usr/bin/env node
/**
 * The combined homomorphic-split run (Route 1), in one process and one receipt:
 *
 *   1. earn: a device enrolled under the requester's account serves another account's whole-model answers (the
 *      north-star earn step, unchanged), so the requester spends credits it earned;
 *   2. quote: the ledger reserves the request and quotes its credit cap before anything leaves the requester;
 *   3. spend: one request on Doppler's encrypted tiny fixture (branch `protected-he-split`), split across two GPU
 *      evaluators. The requester (this machine, Go/Lattigo) holds the only secret key and no weights; it sends each
 *      step's input ciphertexts to stage A (embedding and attention, holding the encrypted KV cache), which sends one
 *      carry ciphertext straight to stage B (MLP, final norm, head), which returns the encrypted logits. The requester
 *      decrypts only the logits. No requester refresh is needed (the block fits the level budget);
 *   4. record: each stage signs its acceptance, a stage receipt per token and a delivery record per token (digests and
 *      sizes of the ciphertexts it received and sent); the requester signs terms, acknowledgments and any stop;
 *   5. settle and verify: the ledger settles from the signed records, an independent replay of the same records must
 *      equal it, and `scripts/settlement/verify-trade.js` must pass. The same for a stop case (the requester stops
 *      mid-answer) and a failure case (stage B's evaluator dies mid-answer).
 *
 *   node scripts/he-split/run.js --hosts PRIVATE_FILE --work DIRECTORY --out RECEIPT_DIRECTORY
 *
 * Evaluators are started per attempt and stopped after it; standing services are not touched. The receipt carries no
 * host path, SSH alias or address from the host file. A pass is not a security review, a separate-operator result or a
 * capacity claim: see `notEstablished`.
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
import { fleetCreditQuote } from '../../server/fleet/contract.js';
import { createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { ledgerTrace, openReservationCount } from '../stage1/split-evidence.js';
import { startPhysicalCoordinator } from '../stage1/physical-coordinator.js';
import { openAgentSession, createSshTransport } from '../stage1/command-transport.js';
import { harnessDigest, readHostIdentity } from '../stage1/host-agent.js';
import { verifyTrade } from '../settlement/verify-trade.js';

export const HE_SPLIT_HOSTS_SCHEMA = 'reploid.he-split-hosts/v1';
export const HE_SPLIT_RECEIPT_SCHEMA = 'reploid.he-split-receipt/v1';
export const HE_SPLIT_PLAN_SCHEMA = 'doppler.protected-he-split-plan/v1';
const EARN_MAX_REQUESTS = 6;
const ROLES = ['stage-a', 'stage-b'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const median = list => { const sorted = list.filter(Number.isFinite).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };

/** A JSON-lines session with a stage agent: `call(op, body)`. */
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
    call(op, body = {}, timeoutMs = 300000) {
      if (closed) return Promise.reject(Error('agent session closed'));
      const id = next++;
      child.stdin.write(JSON.stringify({ id, op, body }) + '\n');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(Error(`${op} timed out`)); }, timeoutMs);
        pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      });
    },
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
  const keep = ['schema', 'label', 'machineId', 'participantId', 'role', 'modelId', 'weights', 'name', 'prompt', 'stage', 'id', 'identity', 'profile', 'cutLayer'];
  const collect = value => {
    if (typeof value === 'string') { if (value.length >= 4 && (value.includes('/') || value.includes('\\') || /\d+\.\d+\.\d+\.\d+/.test(value) || /[A-Za-z]/.test(value))) secrets.add(value); return; }
    if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => { if (!keep.includes(key)) collect(item); });
  };
  collect({ requester: config.requester, stages: config.stages, doppler: config.doppler, coordinator: config.coordinator, earner: config.earner, hop: config.hop });
  for (const home of ['/Users/', '/home/', '/mnt/', 'C:\\Users\\']) secrets.add(home);
  for (const word of ['stage-a', 'stage-b', 'requester', 'research-n16-u32']) secrets.delete(word);
  const ordered = () => [...secrets].sort((a, b) => b.length - a.length);
  const text = value => ordered().reduce((out, secret) => out.split(secret).join('<redacted>'), String(value));
  return { add: value => { if (typeof value === 'string' && value) secrets.add(value); }, text, receipt: value => JSON.parse(text(JSON.stringify(value))) };
}

export function validateHeSplitConfig(config) {
  const refuse = message => { throw Error(`he-split-config: ${message}`); };
  if (config?.schema !== HE_SPLIT_HOSTS_SCHEMA) refuse('schema');
  if (!Array.isArray(config.stages) || config.stages.length !== 2 || config.stages.map(s => s.role).join() !== ROLES.join()) refuse('stages: stage-a then stage-b');
  for (const stage of config.stages) {
    for (const key of ['label', 'machineId', 'role', 'agent', 'identityFile', 'command', 'cwd', 'programs', 'listen', 'endpoint', 'stateDirectory', 'reportFile']) {
      if (stage[key] === undefined) refuse(`stage.${key}`);
    }
    if (stage.machineId === config.requester.machineId) refuse(`${stage.label}: a stage on the requester's machine`);
  }
  if (config.stages[0].machineId === config.stages[1].machineId) refuse('both stages on one machine');
  if (!config.hop?.address) refuse('hop.address: stage B\'s hop listener');
  if (!/^sha256:[0-9a-f]{64}$/.test(config.model?.identity ?? '') || !config.model?.id) refuse('model');
  if (config.credit?.weights?.length !== 4) refuse('credit.weights: edge-in, stage A, stage B, edge-out');
  return config;
}

export async function runHeSplit({ config, directory, log = () => {}, now = Date.now, transport = createSshTransport() }) {
  validateHeSplitConfig(config);
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
  const model = { id: config.model.id, identity: config.model.identity };
  // The split plan: what each stage computes. Its digest is the route's plan identity.
  const plan = { schema: HE_SPLIT_PLAN_SCHEMA, model, profile: config.doppler.profile, programs: config.doppler.programIdentities, cutLayer: 'ln2',
    stages: [{ index: 0, role: 'stage-a', computes: ['embedding (encrypted one-hot lookups)', 'layer norm 1', 'attention scores', 'softmax', 'attention values', 'residual'],
      holds: ['encrypted KV cache'] },
    { index: 1, role: 'stage-b', computes: ['layer norm 2', 'MLP (GELU)', 'residual', 'final layer norm', 'tied LM head'], holds: [] }],
    carry: { ciphertexts: 1, degree: 1, level: 24 }, requesterRefreshes: 0, bootstrapping: false };
  const planBytes = Buffer.from(JSON.stringify(plan));
  const planId = 'sha256:' + sha256(planBytes);
  const stagesCfg = config.stages;

  const requester = await readHostIdentity(config.requester.identityFile);
  const edgeIn = await readHostIdentity(config.requester.edgeInIdentityFile);
  const edgeOut = await readHostIdentity(config.requester.edgeOutIdentityFile);
  const signers = { requester: createAttemptEvidenceSigner({ identity: requester, now }), edgeIn: createAttemptEvidenceSigner({ identity: edgeIn, now }),
    edgeOut: createAttemptEvidenceSigner({ identity: edgeOut, now }) };

  // Each stage proves its identity once, from its own host.
  const proven = [];
  for (const stage of stagesCfg) {
    const session = agentSession(stage.agent, { log: line => log(`${stage.label} ${redactor.text(line)}`) });
    await session.hello;
    const proved = await session.call('identity', { file: stage.identityFile });
    if (await createPeerIdFromPublicJwk(proved.publicJwk) !== proved.participantId) throw Error(`${stage.label} proved a malformed identity`);
    proven.push({ ...stage, participantId: proved.participantId, publicJwk: proved.publicJwk });
    await session.end();
  }
  const participants = { requester: { participantId: requester.peerId, publicJwk: requester.publicJwk },
    edgeIn: { participantId: edgeIn.peerId, publicJwk: edgeIn.publicJwk }, edgeOut: { participantId: edgeOut.peerId, publicJwk: edgeOut.publicJwk } };

  const receipt = { schema: HE_SPLIT_RECEIPT_SCHEMA, startedAt: stamp(), finishedAt: null,
    release: { reploid: config.release?.reploid ?? null, doppler: config.release?.doppler ?? null },
    workload: { modelId: model.id, modelIdentity: model.identity, catalogued: false, planId, plan,
      note: 'Doppler\'s tiny d=16 one-block GPT-2-shaped research fixture, not a catalogued model' },
    participants: null, requester: null, hosts: null, earn: null, quote: null, split: null, stop: null, failure: null,
    privacy: null, integrity: null, cost: null, cleanup: null, steps, error: null, verdict: null };

  const buyer = config.earner ? await createSigningIdentity({ algorithm: 'Ed25519' }) : null;
  const accounts = [{ label: 'requester', participants: [participants.requester, participants.edgeIn, participants.edgeOut] },
    ...proven.map(stage => ({ label: stage.label, participants: [{ participantId: stage.participantId, publicJwk: stage.publicJwk }] }))];
  let earner = null, coordinator = null, credits = null, ledgerFile = null;
  const sessions = [];
  const cpt = config.credit.creditsPerOutputToken ?? 1;
  try {
    // The ledger and service: the north-star coordinator, with the earn model beside this route's plan.
    if (config.earner) {
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
    }
    const earnModel = config.earner ? catalog.find(row => row.id === config.earner.modelId) : null;
    coordinator = await step('start coordinator', () => startPhysicalCoordinator({ config: { coordinator: config.coordinator, credit: { ...config.credit, weights: [1, 1] } },
      peers: {}, directory, model: { id: model.id, identity: model.identity, partitionPlanId: planId }, fixture: { maxOutputTokens: config.credit.maxOutputTokens },
      expectations: { creditsPerOutputToken: cpt }, computers: accounts, allowSameOwner: true, roomPrefix: 'reploid-swarm-he-split-', onSecret: value => redactor.add(value),
      ...(earnModel ? { earnModel: { id: earnModel.id, identity: earnModel.identity } } : {}) }));
    redactor.add(coordinator.serviceUrl); redactor.add(coordinator.signalingUrl);
    credits = coordinator.credits; ledgerFile = coordinator.ledgerFile;
    const accountOf = id => credits.enrollment.byPeer.get(id)?.computerId ?? id;
    const balance = computerId => credits.snapshot().accounts.find(row => row.computerIds.includes(computerId))?.balance ?? null;
    receipt.participants = { accounts: accounts.map(account => ({ accountId: `owner-${account.label}`, participants: account.participants.map(row => row.participantId) })),
      requester: { participantId: requester.peerId, machineId: config.requester.machineId, edgeIn: edgeIn.peerId, edgeOut: edgeOut.peerId },
      stages: proven.map((stage, index) => ({ label: stage.label, machineId: stage.machineId, role: stage.role, index, participantId: stage.participantId, account: `owner-${stage.label}`,
        gpu: stage.gpu ?? null })),
      sameOwner: 'One person owns every machine; the accounts are separate ledger accounts, not independent operators.' };
    receipt.requester = { participantId: requester.peerId, computerId: 'computer-requester' };
    receipt.hosts = [{ label: 'edge-in', participantId: edgeIn.peerId, computerId: 'computer-requester' },
      ...proven.map(stage => ({ label: stage.label, participantId: stage.participantId, computerId: `computer-${stage.label}` })),
      { label: 'edge-out', participantId: edgeOut.peerId, computerId: 'computer-requester' }];

    // 1. Earn (north-star step, unchanged).
    if (config.earner) {
      await step('earn open whole model', () => earner.call('open-whole', { modelId: config.earner.modelId, modelDirectory: config.earner.modelDirectory }));
      const accountId = 'computer-requester', before = balance(accountId), settlements = [];
      const client = createFleetClient({ url: coordinator.serviceUrl, identity: buyer, ...(coordinator.serviceCa ? { ca: coordinator.serviceCa } : {}) });
      const target = config.earnTarget ?? 2 * config.credit.maxOutputTokens * cpt;
      for (let index = 0; index < EARN_MAX_REQUESTS && (balance(accountId) ?? 0) < target; index++) {
        const requestId = `he-split-earn-${index}-${randomUUID()}`;
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

    // 2-5. One attempt per case.
    const runCase = async kase => {
      const attemptId = `he-${kase.name}-${randomUUID()}`, reservationId = `he-split-${kase.name}-${randomUUID()}`, threadId = `he-thread-${randomUUID()}`;
      const stageIds = [edgeIn.peerId, ...proven.map(stage => stage.participantId), edgeOut.peerId];
      const identity = { schema: ROUTE_ATTEMPT_SCHEMA, threadId, attemptId, requesterId: requester.peerId, placementGeneration: 0,
        route: { schema: PARTITION_ROUTE_SCHEMA, modelId: model.id, modelIdentity: model.identity, planId,
          stages: stageIds.map((participantId, index) => ({ index, participantId, transportId: `he-link-${index}`, residentId: `he-${index}`, executionId: `${attemptId}:${index}` })),
          // What crosses between stages is a CKKS ciphertext, not a plaintext activation tensor.
          activation: { schema: 'doppler.activation-tensor/v1', dtype: 'f32', hiddenSize: 16, precision: 'f32', components: 1, elementStrideBytes: 4 } } };
      const weights = config.credit.weights;
      const record = { case: kase.name, attemptId, reservationId, prompt: kase.prompt, maxOutputTokens: kase.maxTokens, events: [], tokens: [], text: '', streamed: '' };
      const agents = [], held = { terms: null, acceptances: [], acks: [], stop: null, edge: { in: [], out: [] } };
      let edgeInReceipts = null, edgeOutReceipts = null, acks = null, beforeBalance = null, result = null, failure = null;

      // Quote and hold the cap before any input leaves this machine.
      const quote = fleetCreditQuote(credits.policy, kase.maxTokens, 'partition');
      beforeBalance = balance('computer-requester');
      const binding = credits.reserve({ id: reservationId, executionId: attemptId, consumer: requester.peerId, mode: 'partition', model: { ...model, adapterIdentities: [] },
        inputDigest: 'sha256:' + sha256(JSON.stringify([{ role: 'user', content: kase.prompt }])), maxOutputTokens: kase.maxTokens,
        providers: stageIds.map((participantId, index) => ({ participantId, weight: weights[index] })), route: identity, acceptedQuote: quote });
      record.quote = { quotedBeforeDispatch: structuredClone(quote), hold: binding.maximum, at: stamp(), balanceBefore: beforeBalance, balanceHeld: balance('computer-requester') };
      try {
        held.terms = await signSettlementTerms({ signer: signers.requester, identity, reservationId, policy: credits.policy, maxOutputTokens: kase.maxTokens, weights,
          notBefore: binding.createdAt, deadline: binding.deadline, maxUnacknowledgedOutputs: credits.policy.maxUnacknowledgedOutputs ?? MAX_UNACKNOWLEDGED_OUTPUTS });
        held.acceptances.push(await acceptSettlementTerms({ signer: signers.edgeIn, terms: held.terms, partitionIndex: 0 }));
        // Stage B first: it must listen for stage A's hop link before stage A dials it.
        for (const index of [1, 0]) {
          const stage = proven[index];
          const session = agentSession(stage.agent, { log: line => log(`${stage.label} ${redactor.text(line)}`) });
          agents[index] = session;
          await session.hello;
          await session.call('identity', { file: stage.identityFile });
          const programs = stage.programs.flatMap(base => ['--program', base]);
          const link = stage.role === 'stage-a' ? ['--next', config.hop.address] : ['--hop-listen', config.hop.address];
          const opened = await session.call('open', { command: stage.command, cwd: stage.cwd, stage: stage.role,
            args: [...programs, '--listen', stage.listen, '--state-dir', stage.stateDirectory, '--report', stage.reportFile, '--timing', config.timing ?? 'overlap', ...link] });
          record[`${stage.role}Listening`] = Boolean(opened.listening);
        }
        for (const [index] of proven.entries()) held.acceptances.push(await agents[index].call('accept', { terms: held.terms, partitionIndex: index + 1 }));
        held.acceptances.push(await acceptSettlementTerms({ signer: signers.edgeOut, terms: held.terms, partitionIndex: stageIds.length - 1 }));
      } catch (error) {
        credits.abandonBeforeDispatch(reservationId, requester.peerId);
        record.abandonedBeforeDispatch = { at: stamp(), error: redactor.text(error?.message ?? error) };
        await Promise.all(agents.filter(Boolean).map(session => session.end()));
        throw error;
      }
      credits.dispatch(reservationId, requester.peerId);
      record.dispatchedAt = stamp();

      acks = await openOutputAcknowledgments({ signer: signers.requester, identity, reservationId, textlessOutputs: true });
      held.acks.push(acks.charge);
      edgeInReceipts = await openStageReceipts({ signer: signers.edgeIn, identity, partitionIndex: 0, charge: acks.charge, textlessOutputs: true });
      edgeOutReceipts = await openStageReceipts({ signer: signers.edgeOut, identity, partitionIndex: stageIds.length - 1, charge: acks.charge, textlessOutputs: true });
      await Promise.all(agents.map((session, index) => session.call('charge', { identity, partitionIndex: index + 1, charge: acks.charge })));

      // The requester process: keys, encryption, decryption and argmax, on this machine only.
      const work = path.join(directory, kase.name);
      await fs.mkdir(work, { recursive: true });
      const reportFile = path.join(work, 'requester-report.json');
      const r = config.doppler;
      const child = spawn('/usr/bin/time', ['-l', r.requester, 'requester', '--profile', r.profile, '--model-identity', model.identity, '--prompt', kase.prompt,
        '--generate', String(kase.maxTokens), '--stage-a', `${proven[0].endpoint.host}:${proven[0].endpoint.port}`, '--stage-b', `${proven[1].endpoint.host}:${proven[1].endpoint.port}`,
        '--state-dir', r.requesterStateDirectory, '--report', reportFile, '--events'], { cwd: r.toolsDirectory, stdio: ['pipe', 'pipe', 'pipe'] });
      const stderr = [];
      readline.createInterface({ input: child.stderr }).on('line', line => { stderr.push(line.slice(0, 300)); });
      let ended = null, failed = null, stopSent = false;
      for await (const line of readline.createInterface({ input: child.stdout })) {
        let event; try { event = JSON.parse(line); } catch { continue; }
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
          if (!isStopped) record.streamed += event.delta;
          if (kase.stopAfter && record.tokens.length === kase.stopAfter && !stopSent) {
            // The requester signs its stop at its acknowledged count before it tells anyone to stop.
            held.stop = await signSettlementStop({ signer: signers.requester, terms: held.terms, acknowledged: acks.state().count });
            child.stdin.write('stop\n'); stopSent = true;
          }
          if (kase.killStage && record.tokens.length === kase.afterTokens) {
            const victim = proven.findIndex(stage => stage.label === kase.killStage);
            record.injected = { at: stamp(), stage: kase.killStage, afterTokens: kase.afterTokens, result: await agents[victim].call('kill') };
          }
        } else if (event.event === 'ready') { record.promptTokens = event.promptTokens; record.keys = { uploaded: event.keysUploaded, bytesPerStage: event.keyBytes }; }
        else if (event.event === 'end') ended = event;
        else if (event.event === 'failed') failed = event;
      }
      await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
      record.requesterTime = stderr.filter(line => /maximum resident set size|real|peak memory footprint/.test(line)).map(line => line.trim());
      record.requesterErrors = stderr.filter(line => !/^\s*\d+\s+[a-z]/.test(line) && !/real|user|sys/.test(line)).slice(-6);
      record.requesterReport = JSON.parse(await fs.readFile(reportFile, 'utf8').catch(() => 'null'));
      if (record.requesterReport) for (const s of record.requesterReport.steps ?? []) delete s.logits; // client-local values stay local
      if (failed || !ended) failure = failed?.error ?? 'no end event';
      result = failure ? { status: 'failed', error: redactor.text(failure) }
        : { status: ended.stopReason === 'requester-stop' ? 'cancelled' : 'completed', stopReason: ended.stopReason, output: record.streamed,
          usage: { inputTokens: record.promptTokens, outputTokens: record.tokens.length } };
      record.result = result;

      // After the route closed: the requester's own reference check (pinned approximate circuit and float64 model).
      if (!failure && record.requesterReport) {
        const compare = spawn(r.requester, ['compare', '--report', reportFile], { cwd: r.toolsDirectory, stdio: ['ignore', 'pipe', 'pipe'] });
        let text = ''; compare.stdout.on('data', chunk => { text += chunk; });
        await new Promise(resolve => compare.once('exit', resolve));
        try { const c = JSON.parse(text); record.reference = { matchesApproximateReference: c.matchesApproximateReference, matchesExactReference: c.matchesExactReference,
          approximateReferenceTokens: c.approximateReferenceTokens, exactReferenceTokens: c.exactReferenceTokens, maxLogitErrorVsApproximate: c.maxLogitErrorVsApproximate,
          maxLogitErrorVsExact: c.maxLogitErrorVsExact, minEncryptedTop1Margin: c.minEncryptedTop1Margin }; } catch { record.reference = null; }
      }

      // Close every stage (a dead evaluator closes failed), the edges here.
      const attemptFailed = result.status === 'failed';
      record.closing = await Promise.all(agents.map((session, index) => session.call('close', { failed: attemptFailed }).then(row => ({ label: proven[index].label, died: row.died,
        evaluatorExit: row.evaluatorExit, status: row.receipt?.status ?? null, memory: row.memory })).catch(error => ({ label: proven[index].label, error: String(error?.message ?? error) }))));
      const closingIn = await edgeInReceipts.close({ failed: attemptFailed });
      const closingOut = await edgeOutReceipts.close({ failed: attemptFailed });
      const agentRecords = await Promise.all(agents.map(session => session.call('records').catch(error => ({ records: [], deliveries: [], log: [{ error: String(error?.message ?? error) }] }))));
      record.evaluatorReports = await Promise.all(agents.map((session, index) => session.call('report', { file: proven[index].reportFile }).catch(() => null)));
      await Promise.all(agents.map(session => session.end()));
      record.deliveries = agentRecords.map((row, index) => ({ label: proven[index].label, role: proven[index].role, participantId: proven[index].participantId,
        records: row.deliveries, log: row.log.slice(-12) }));

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

    for (const kase of config.cases) {
      const key = kase.name === 'split' ? 'split' : kase.name === 'stop' ? 'stop' : 'failure';
      receipt[key] = await step(`case ${kase.name}`, () => runCase(kase));
    }
    receipt.quote = receipt.split?.quote ?? null;
    receipt.privacy = privacyStatement(proven);
    receipt.integrity = integrityStatement();
    receipt.cost = costSummary(receipt.split, proven);
    receipt.cleanup = { heldCredits: credits.snapshot().accounts.reduce((sum, row) => sum + row.held, 0), openReservations: await openReservationCount(ledgerFile) };
  } catch (error) {
    receipt.error = redactor.text(error?.stack ?? error?.message ?? error);
  } finally {
    for (const session of sessions) { try { session.end(); } catch { /* ended */ } }
    if (coordinator) await coordinator.close().catch(() => {});
    receipt.finishedAt = stamp();
  }
  receipt.notEstablished = [
    'Usefulness: the model is a 16-dimension, one-block, 32-symbol research fixture. The Route 1 kill gate (2026-11-25) found no credible path to a useful model on fleet GPUs.',
    'An independent security review of the parameters (research-n16-u32, never estimated) and the protocol.',
    'Integrity: one evaluator per stage and no trap lanes on this route, so a wrong or tampered stage corrupts the answer undetected (confidentiality still holds).',
    'Operator independence: one person owns every machine; the stage accounts are separate ledger accounts, not independent operators.',
    'Transport endpoint identity: the hop link is admitted by a one-time token over WireGuard; the requester links are SSH tunnels; no channel binding to the stage identities.',
    'Outsider reproduction on another machine: the verify-trade kit ran here.'];
  return redactor.receipt(receipt);
}

/** Who could read what on this run, per party and per coalition. */
function privacyStatement(proven) {
  const [a, b] = proven;
  return { tier: 'homomorphic-split (CKKS, requester-held key)', assumption: 'RLWE hardness at the pinned parameters (not estimated); no non-collusion assumption',
    whoCouldRead: [
      { who: 'requester machine (requester, edge-in, edge-out)', reads: 'prompt, answer, token IDs and logits: it holds the only secret key and is the data owner' },
      { who: `${a.label} (stage A: embedding and attention, encrypted KV cache)`, reads: 'public evaluation keys, the public program, input ciphertexts per step, its own KV and carry ciphertexts; the prompt length, generated count, timing and sizes. No key that decrypts any of them' },
      { who: `${b.label} (stage B: MLP, final norm, head)`, reads: 'public evaluation keys, the public program, one carry ciphertext per step and its own output ciphertext; the prompt length (from the schedule), generated count, timing and sizes' },
      { who: 'ledger and signaling', reads: 'identities, model and plan identity, timing, token counts, and signed settlement and delivery records (ciphertext digests and sizes); no ciphertext, no content' },
      { who: 'network observer', reads: 'sizes and timing of SSH- or WireGuard-encrypted links (inner ciphertexts are CKKS ciphertexts besides)' }],
    coalitions: [
      { together: [a.label, b.label], learn: 'nothing more about content: every value either holds is a ciphertext under the requester\'s key, and pooling ciphertexts gives no decryption key' },
      { together: 'both stages, the ledger and a network observer (all colluding)', learn: 'metadata only: model, prompt length, generated count, per-step timing, sizes, and session linkage through the key epoch' }],
    caveats: ['Timing is not shown to be data-independent.', 'A stage that tampers can make the requester decrypt a ciphertext of its choice; the requester never publishes the decryption, but published answers could leak (IND-CPA-D).',
      'Out-of-range inputs make the approximations diverge silently (an accuracy risk, not a confidentiality one).'] };
}

function integrityStatement() {
  return { traps: 'not on this route', detail: 'Trap verification v2 (secret fresh known-answer traps from a trap oracle, with key-epoch retirement after a failure) exists on Doppler branch protected-route and Reploid main\'s parked protected route, for the single-evaluator CPU protocol. It is not wired into the WebGPU split; this run decrypted every result unverified.',
    devCheck: 'On the development ring, the split\'s result equalled a CPU (Lattigo) whole-model evaluator\'s byte for byte at 6 of 6 steps (Doppler gpu_test.go TestWebGPUSplitEqualsCPUEvaluator, run on the Orin GPU).',
    transcript: 'Each stage signed, per step, the digest of the ciphertexts it received and sent; stage A\'s output digest must equal stage B\'s input digest at every step.' };
}

function costSummary(attempt, proven) {
  const events = attempt?.events?.filter(event => event.event === 'token') ?? [];
  if (!events.length) return null;
  const decode = events.slice(1);
  const report = attempt.requesterReport;
  return { prefill: { promptTokens: attempt.promptTokens, roundTripMs: events[0].roundTripMs, stageAMs: events[0].stageAMs, stageBMs: events[0].stageBMs, upBytes: events[0].up,
    hopBytes: events[0].hopBytes, downBytes: events[0].down },
  decodePerToken: { tokens: decode.length, medianWallMs: median(decode.map(e => e.wallMs)), medianRoundTripMs: median(decode.map(e => e.roundTripMs)),
    medianStageAMs: median(decode.map(e => e.stageAMs)), medianStageBMs: median(decode.map(e => e.stageBMs)), upBytes: median(decode.map(e => e.up)),
    hopBytes: median(decode.map(e => e.hopBytes)), downBytes: median(decode.map(e => e.down)), medianEncryptMs: median(decode.map(e => e.encryptMs)), medianDecryptMs: median(decode.map(e => e.decryptMs)) },
  keys: { bytesPerStage: report?.evaluationKeyBytesPerEvaluator ?? null, keygenSeconds: report?.keygenSeconds ?? null, uploadSeconds: report?.keyUploadSeconds ?? null,
    reusedFromStages: report?.evaluationKeysReusedNoUpload ?? null },
  requesterRefreshes: report?.split?.requesterRefreshes ?? null, requesterPeakRss: report?.requesterPeakRSSBytes ?? null, timeToFirstTokenSeconds: report?.timeToFirstTokenSeconds ?? null,
  stages: proven.map((stage, index) => ({ label: stage.label, role: stage.role, peakRssBytes: attempt.closing?.[index]?.memory?.peakRssBytes ?? null,
    peakGpuBufferBytes: attempt.evaluatorReports?.[index]?.gpu?.peakBufferBytes ?? null, evaluationKeyBytesResident: attempt.evaluatorReports?.[index]?.gpu?.evaluationKeyBytesResident ?? null,
    adapter: attempt.evaluatorReports?.[index]?.adapter ?? null })) };
}

/** The outcome: every attempt verifies by the outsider kit, the split answer matches, nothing is held. */
export async function checkHeSplit(receipt) {
  const problems = [];
  const fail = (code, detail) => problems.push({ code, detail: String(detail) });
  if (receipt.error) fail('run-error', receipt.error);
  if (receipt.earn && !(receipt.earn.accountAfter > receipt.earn.accountBefore)) fail('earn', 'the account did not earn');
  for (const key of ['split', 'stop', 'failure']) {
    const attempt = receipt[key];
    if (!attempt) { fail('missing-case', key); continue; }
    if (!attempt.quote?.quotedBeforeDispatch) fail('no-quote', key);
    if (attempt.settleError && key === 'split') fail('settle', attempt.settleError);
    // The ciphertext chain: what stage A sent is what stage B received, at every step.
    const [a, b] = attempt.deliveries ?? [];
    const outs = (a?.records ?? []).map(row => row.body?.output?.digest ?? row.output?.digest);
    const ins = (b?.records ?? []).map(row => row.body?.input?.digest ?? row.input?.digest);
    if (key === 'split' && (outs.length === 0 || outs.length !== ins.length || outs.some((digest, index) => digest !== ins[index]))) fail('hop-chain', `${outs.length} sent, ${ins.length} received`);
  }
  if (receipt.split?.result?.status !== 'completed') fail('split-status', receipt.split?.result?.status);
  if (receipt.split && !(receipt.split.reference?.matchesApproximateReference && receipt.split.reference?.matchesExactReference)) fail('tokens', 'the split answer differs from a reference');
  if (receipt.stop && receipt.stop.result?.status !== 'cancelled') fail('stop-status', receipt.stop.result?.status);
  if (receipt.failure && receipt.failure.result?.status !== 'failed') fail('failure-status', receipt.failure.result?.status);
  if (receipt.split?.requesterReport?.split?.requesterRefreshes !== 0) fail('refreshes', 'requester refreshes not recorded as 0');
  const verdict = await verifyTrade({ receipt });
  for (const row of verdict.attempts) if (!row.ok) fail(`verify-trade-${row.name}`, row.problems.join('; '));
  if (receipt.cleanup && (receipt.cleanup.heldCredits !== 0 || receipt.cleanup.openReservations !== 0)) fail('stranded-hold', JSON.stringify(receipt.cleanup));
  return { passed: problems.length === 0, problems, verifyTrade: verdict };
}

async function main() {
  const { values } = parseArgs({ options: { hosts: { type: 'string' }, work: { type: 'string' }, out: { type: 'string' } } });
  if (!values.hosts || !values.work || !values.out) throw Error('Usage: run.js --hosts PRIVATE_FILE --work DIRECTORY --out RECEIPT_DIRECTORY');
  const config = JSON.parse(await fs.readFile(values.hosts, 'utf8'));
  const receipt = await runHeSplit({ config, directory: path.resolve(values.work), log: line => process.stderr.write(line + '\n') });
  receipt.verdict = await checkHeSplit(receipt);
  await fs.mkdir(values.out, { recursive: true });
  await fs.writeFile(path.join(values.out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  process.stderr.write(`verdict: ${receipt.verdict.passed ? 'passed' : 'failed'}${receipt.verdict.problems.map(row => `\n  ${row.code}: ${row.detail}`).join('')}\n`);
  if (!receipt.verdict.passed) process.exitCode = 1;
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) {
  try { await main(); } catch (error) { process.stderr.write(`${error.stack ?? error.message}\n`); process.exitCode = 1; }
}
