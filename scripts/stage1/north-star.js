#!/usr/bin/env node
/**
 * The unified north-star run on physical hosts, in one process and one receipt:
 *
 *   1. earn: a device enrolled under the requester's account serves whole-model answers to another account (a buyer on
 *      the operator machine); each answer is metered, signed, countersigned and settled once on the ledger;
 *   2. spend: from that account, one request of the catalogued 27B, split across four ordered stages
 *      (edges-plan.js): the requester's own machine runs stage 0 (embedding, layer 0, tokenizer, coordinator) and
 *      stage 3 (layer 63, final norm, output head, sampling, detokenizing); two other machines run layers 1-31 and
 *      32-62. The request goes through `reploid/inference` with `confidentiality: 'requester-edges'`;
 *   3. who read what: every stage process records what its resident was handed (visibility trace), each stage's loader
 *      records the weight pieces it served, and the plan's disclosures and the execution receipt state the tier;
 *   4. verify, in the same run: the answer's tokens against the frozen single-host reference (and the input and output
 *      witnesses), the debit and every payout on the ledger, and an independent replay of the settlement from the
 *      participants' own signed records, which must equal the ledger.
 *
 *   node scripts/stage1/north-star.js --hosts PRIVATE_FILE --fixture REFERENCE.json --window-until ISO_TIME --work DIRECTORY --out RECEIPT.json
 *
 * Standing services on the hosts are left running; nothing is paused, so nothing needs restoring. Each step is bounded
 * and logged with UTC times; whatever happens, every agent session is closed and the coordinator stopped. The written
 * receipt carries no host path, SSH alias, room token or address from the host file. Exit status 0 means every check
 * passed. A pass is not a security review, a separate-operator result or a capacity claim: see `notEstablished`.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import { createPeerIdFromPublicJwk, createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { countersignReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';
import { createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { openAgentSession, parseControlReply, createSshTransport } from './command-transport.js';
import { harnessDigest, readReleaseSha } from './host-agent.js';
import { startPhysicalCoordinator } from './physical-coordinator.js';
import { collectSettlementReplay, ledgerTrace, openReservationCount, until, verifySplitTokens } from './split-evidence.js';
import { EDGES_ROLES, EDGES_SPLIT_LAYERS, edgesInventory, edgesInventorySha256, loadEdgesModel } from './edges-plan.js';
import { witnessDigest, stage1Decoding } from './expectations.js';
import { checkNorthStar, summarizeVisibility } from './north-star-check.js';
export { checkNorthStar, summarizeVisibility };

export const NORTH_STAR_HOSTS_SCHEMA = 'reploid.north-star-hosts/v1';
export const NORTH_STAR_RECEIPT_SCHEMA = 'reploid.north-star-receipt/v1';
const EARN_MAX_REQUESTS = 6;
const TARGET_KEYS = ['label', 'machineId', 'participantId', 'ssh', 'node', 'releaseRoot', 'identityFile', 'stateDirectory'];

const refuse = message => { throw Object.assign(Error(`north-star-config: ${message}`), { code: 'north-star-config' }); };
const absolute = value => typeof value === 'string' && value.startsWith('/') && path.posix.normalize(value) === value;

/** The private host file: four ordered stages whose roles match the edges plan, the requester and the earner. */
export function validateNorthStarConfig(config) {
  if (config?.schema !== NORTH_STAR_HOSTS_SCHEMA) refuse('schema');
  const target = (row, field, extra = []) => {
    for (const key of [...TARGET_KEYS, ...extra]) if (row?.[key] === undefined) refuse(`${field}.${key}`);
    for (const key of ['node', 'releaseRoot', 'identityFile', 'stateDirectory', ...extra.filter(key => key.endsWith('Directory'))]) {
      if (!absolute(row[key])) refuse(`${field}.${key} must be an absolute path`);
    }
    if (!/^peer:[0-9a-f]{24}$/.test(row.participantId)) refuse(`${field}.participantId`);
  };
  target(config.requester, 'requester', ['modelDirectory']);
  if (!Array.isArray(config.stages) || config.stages.length !== EDGES_ROLES.length) refuse(`stages: exactly ${EDGES_ROLES.length}`);
  config.stages.forEach((stage, index) => {
    target(stage, `stages[${index}]`, ['stageDirectory']);
    if (stage.role !== EDGES_ROLES[index]) refuse(`stages[${index}].role must be ${EDGES_ROLES[index]}`);
    // A requester-held stage runs on the requester's machine; an operator stage never does.
    if ((stage.role === 'requester') !== (stage.machineId === config.requester.machineId)) refuse(`stages[${index}] machine does not match its role`);
  });
  const operators = config.stages.filter(stage => stage.role === 'operator');
  if (new Set(operators.map(stage => stage.machineId)).size !== operators.length) refuse('each operator stage needs its own machine');
  const ids = [config.requester, ...config.stages, ...(config.earner ? [config.earner] : [])].map(row => row.participantId);
  if (new Set(ids).size !== ids.length) refuse('participant IDs must be distinct');
  const labels = [config.requester, ...config.stages, ...(config.earner ? [config.earner] : [])].map(row => row.label);
  if (new Set(labels).size !== labels.length || labels.some(label => !/^[a-z][a-z0-9-]{0,31}$/.test(label))) refuse('labels must be distinct neutral names');
  if (config.earner) {
    target(config.earner, 'earner', ['modelDirectory']);
    const model = catalog.find(row => row.id === config.earner.modelId);
    if (!model || model.partitionPlanId) refuse('earner.modelId must name a whole-model catalog entry');
    if (operators.some(stage => stage.participantId === config.earner.participantId)) refuse('the earner cannot be a stage');
  }
  const weights = config.credit?.weights;
  if (!Array.isArray(weights) || weights.length !== EDGES_ROLES.length || !weights.every(value => Number.isSafeInteger(value) && value > 0)) refuse('credit.weights');
  for (const key of ['maxDebt', 'maxRequestMs', 'partitionUnclaimedReleaseMs']) if (!Number.isSafeInteger(config.credit[key])) refuse(`credit.${key}`);
  for (const key of ['phaseMs', 'stepMs']) if (!Number.isSafeInteger(config.limits?.[key]) || config.limits[key] <= 0) refuse(`limits.${key}`);
  return config;
}

/** Removes every host-file string that could name a machine, path, alias or address, and every run secret. */
export function createNorthStarRedactor(config) {
  const secrets = new Set();
  const collect = value => {
    if (typeof value === 'string') { if (value.length >= 4 && (value.includes('/') || /[A-Za-z]/.test(value))) secrets.add(value); return; }
    if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => {
      if (!['schema', 'label', 'machineId', 'participantId', 'role', 'modelId', 'weights'].includes(key)) collect(item);
    });
  };
  collect({ coordinator: config.coordinator, requester: config.requester, stages: config.stages, earner: config.earner });
  for (const home of ['/Users/', '/home/', '/mnt/']) secrets.add(home);
  const ordered = () => [...secrets].sort((a, b) => b.length - a.length);
  const text = value => ordered().reduce((out, secret) => out.split(secret).join('<redacted>'), String(value));
  return { add: value => { if (typeof value === 'string' && value) secrets.add(value); }, text,
    receipt: value => JSON.parse(text(JSON.stringify(value))) };
}

export async function runNorthStar({ config, transport, directory, fixtureFile, windowUntil, log = () => {}, now = Date.now,
  startCoordinator = startPhysicalCoordinator, localDigest = harnessDigest }) {
  validateNorthStarConfig(config);
  const deadline = Date.parse(windowUntil);
  if (!Number.isFinite(deadline) || deadline - now() < 10 * 60000) throw Error('The window must leave at least ten minutes');
  const redactor = createNorthStarRedactor(config);
  const limits = config.limits, stepMs = limits.stepMs;
  const stamp = () => new Date(now()).toISOString();
  const steps = [];
  const step = async (name, work, ms = stepMs) => {
    if (now() + 5000 > deadline) throw Error(`window ends before ${name}`);
    const started = now();
    log(`${stamp()} ${name} start`);
    let timer;
    try {
      const value = await Promise.race([work(Math.min(ms, deadline - now())), new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`${name} exceeded ${ms} ms`)), Math.min(ms, deadline - now())); })]);
      steps.push({ name, startedAt: new Date(started).toISOString(), ms: now() - started, ok: true });
      log(`${stamp()} ${name} done after ${now() - started} ms`);
      return value;
    } catch (error) {
      steps.push({ name, startedAt: new Date(started).toISOString(), ms: now() - started, ok: false, error: redactor.text(error?.message ?? error) });
      log(`${stamp()} ${name} failed after ${now() - started} ms: ${redactor.text(error?.message ?? error)}`);
      throw error;
    } finally { clearTimeout(timer); }
  };

  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const { model, plan } = await loadEdgesModel();
  const inventory = await edgesInventory({ model, plan });
  const fixtureSource = JSON.parse(await fs.readFile(fixtureFile, 'utf8'));
  if (fixtureSource.modelId !== model.id || fixtureSource.modelIdentity !== model.identity) throw Error('The reference is for another model');
  // The reference tokens come from one host running the whole model; they do not depend on how the layers are cut. The
  // witnesses bind the plan, so the run's copy names this plan and nothing else changes.
  const fixtureBytes = Buffer.from(JSON.stringify({ ...fixtureSource, planIdentity: model.partitionPlanId }));
  const fixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
  const reference = { outputIds: [...fixtureSource.reference.visibleOutputIds, fixtureSource.reference.stopId],
    outputText: fixtureSource.reference.outputText };
  reference.sampleDigest = witnessDigest(reference.outputIds);
  const earnModel = config.earner ? catalog.find(row => row.id === config.earner.modelId) : null;
  const weights = config.credit.weights;

  const sessions = new Map(), peers = {};
  let coordinator = null, buyer = null;
  const receipt = { schema: NORTH_STAR_RECEIPT_SCHEMA, startedAt: stamp(), finishedAt: null, release: null,
    workload: { modelId: model.id, modelIdentity: model.identity, quantization: model.quantization, planIdentity: model.partitionPlanId,
      splitLayers: [...EDGES_SPLIT_LAYERS], inventorySha256: edgesInventorySha256(inventory),
      stages: inventory.stages.map(({ ranges: _ranges, ...row }) => row), referenceFixtureSha256: createHash('sha256').update(await fs.readFile(fixtureFile)).digest('hex'),
      runFixtureSha256: fixtureSha256, messagesDigest: await hashJson(fixtureSource.messages), maxOutputTokens: fixtureSource.maxOutputTokens,
      decoding: stage1Decoding(model.generation), reference: { outputCount: reference.outputIds.length, sampleDigest: reference.sampleDigest } },
    participants: null, requester: null, hosts: null, earn: null, split: null, privacy: null, cleanup: null, steps, error: null, verdict: null };

  const agent = (target, mode) => [target.node, `${target.releaseRoot}/scripts/stage1/host-agent.js`, mode];
  async function control(target, op, body = {}, timeoutMs = stepMs) {
    const { code, stdout } = await transport.run(target, agent(target, '--control'), { input: JSON.stringify({ op, body }), timeoutMs });
    const answer = parseControlReply(stdout);
    if (!answer) throw Error(`${target.label} ${op}: no reply (exit ${code})`);
    if (answer.error) throw Object.assign(Error(answer.error), { code: answer.code });
    return answer.result;
  }
  const expectedDigest = await localDigest();
  async function open(target) {
    const session = openAgentSession(transport.open(target, agent(target, '--session')), { defaultTimeoutMs: limits.phaseMs });
    session.target = target;
    await session.hello;
    if (session.harnessDigest !== expectedDigest) { session.end(); throw Error(`${target.label} runs other harness code`); }
    sessions.set(target.label, session);
    const proved = await session.call('identity', { file: target.identityFile });
    if (proved.participantId !== target.participantId || await createPeerIdFromPublicJwk(proved.publicJwk) !== target.participantId) {
      throw Error(`${target.label} proved another identity`);
    }
    peers[target.label] = proved;
    return session;
  }
  const s = label => sessions.get(label);
  const accountOf = id => coordinator.credits.enrollment.byPeer.get(id)?.ownerId ?? null;
  // Balances and journal rows are keyed by the account's computer (`computer-<label>`), as in Stage 1.
  const balanceOfAccount = computerId => coordinator.credits.snapshot().accounts.find(row => row.computerIds.includes(computerId))?.balance ?? null;
  const settled = id => until(() => coordinator.credits.request(id)?.state === 'settled', { timeoutMs: config.credit.maxRequestMs, label: 'settlement', pollMs: 250 });

  try {
    receipt.release = { sha: await readReleaseSha(), harnessDigest: expectedDigest };
    // Preflight: every host runs this release, proves its identity, and holds its stage directory as built for this plan.
    const targets = [config.requester, ...config.stages, ...(config.earner ? [config.earner] : [])];
    for (const target of targets) await step(`open ${target.label}`, () => open(target));
    for (const target of targets) {
      const release = await step(`release ${target.label}`, () => control(target, 'release'));
      if (release.harnessDigest !== expectedDigest || release.releaseSha !== receipt.release.sha) throw Error(`${target.label} runs release ${release.releaseSha}`);
    }
    const directories = [];
    for (const [index, stage] of config.stages.entries()) {
      directories.push(await step(`verify stage directory ${stage.label}`, () => control(stage, 'edges-stage-directory', { action: 'verify', stageIndex: index, directory: stage.stageDirectory })));
    }
    const requesterAccount = 'requester';
    const accounts = [{ label: requesterAccount, participants: [peers[config.requester.label], ...config.stages.filter(stage => stage.role === 'requester').map(stage => peers[stage.label]),
      ...(config.earner ? [peers[config.earner.label]] : [])] },
    ...config.stages.filter(stage => stage.role === 'operator').map(stage => ({ label: stage.label, participants: [peers[stage.label]] }))];
    buyer = config.earner ? await createSigningIdentity({ algorithm: 'Ed25519' }) : null;
    if (buyer) accounts.push({ label: 'buyer', participants: [{ participantId: buyer.peerId, publicJwk: buyer.publicJwk }] });
    coordinator = await step('start coordinator', () => startCoordinator({ config: { ...config, hosts: config.stages }, peers, directory, model, fixture: fixtureSource,
      expectations: { creditsPerOutputToken: 1 }, computers: accounts.map(account => ({ ...account, participants: account.participants.map(row => ({ participantId: row.participantId, publicJwk: row.publicJwk })) })),
      allowSameOwner: true, roomPrefix: 'reploid-swarm-northstar-', onSecret: value => redactor.add(value),
      ...(buyer ? { earnModel: { id: earnModel.id, identity: earnModel.identity } } : {}) }));
    redactor.add(coordinator.signalingUrl); redactor.add(coordinator.serviceUrl);
    receipt.participants = {
      accounts: accounts.map(account => ({ accountId: `owner-${account.label}`, participants: account.participants.map(row => row.participantId) })),
      requester: { label: config.requester.label, participantId: config.requester.participantId, machineId: config.requester.machineId, account: `owner-${requesterAccount}` },
      stages: config.stages.map((stage, index) => ({ label: stage.label, stageIndex: index, role: stage.role, participantId: stage.participantId, machineId: stage.machineId,
        account: stage.role === 'requester' ? `owner-${requesterAccount}` : `owner-${stage.label}`, layerRange: inventory.stages[index].layerRange,
        capabilityRemap: stage.capabilityRemap === true,
        directory: { rangeCount: directories[index].rangeCount, bytes: directories[index].bytes, rangesDigest: directories[index].rangesDigest } })),
      earner: config.earner ? { label: config.earner.label, participantId: config.earner.participantId, machineId: config.earner.machineId, account: `owner-${requesterAccount}`, modelId: earnModel.id } : null,
      buyer: buyer ? { participantId: buyer.peerId, account: 'owner-buyer', where: 'operator machine' } : null,
      sameOwner: 'One person owns every machine; the accounts are separate ledger accounts, not independent operators.' };
    // Who signs for which ledger computer, in the Stage 1 shape the outsider kit (scripts/settlement/verify-trade.js) reads.
    receipt.requester = { participantId: config.requester.participantId, computerId: `computer-${requesterAccount}` };
    receipt.hosts = config.stages.map((stage, index) => ({ label: stage.label, stageIndex: index, participantId: stage.participantId,
      computerId: stage.role === 'requester' ? `computer-${requesterAccount}` : `computer-${stage.label}` }));

    // 1. Earn: the requester's account serves a different account's whole-model requests.
    if (config.earner) {
      const earner = s(config.earner.label);
      await step('earn open whole model', () => earner.call('open-whole', { modelId: earnModel.id, modelDirectory: config.earner.modelDirectory }));
      const accountId = `computer-${requesterAccount}`, before = balanceOfAccount(accountId), settlements = [];
      const target = 2 * fixtureSource.maxOutputTokens;
      const client = createFleetClient({ url: coordinator.serviceUrl, identity: buyer, ...(coordinator.serviceCa ? { ca: coordinator.serviceCa } : {}) });
      for (let index = 0; index < EARN_MAX_REQUESTS && (balanceOfAccount(accountId) ?? 0) < target; index++) {
        const requestId = `northstar-earn-${index}-${randomUUID()}`;
        const participant = { async generate(request, controls) {
          if (await controls.requestApproval({ requestId, recipientIdentity: config.earner.participantId, input: { messages: request.messages } }) !== true) throw Error('Earn request not approved');
          const served = await earner.call('serve-whole', { requestId, consumer: buyer.peerId, messages: request.messages, settings: request.settings, timeoutMs: limits.phaseMs },
            { timeoutMs: limits.phaseMs + 5000 });
          return { content: served.content, execution: { receipt: await countersignReceipt(served.receipt, buyer) } };
        } };
        const requester = createFleetRequester({ participant, identity: buyer, credits: client, maxOutputTokens: fixtureSource.maxOutputTokens });
        await step(`earn request ${index}`, async () => {
          const result = await requester.generate({ model: { id: earnModel.id, identity: earnModel.identity }, messages: [{ role: 'user', content: `Write a short paragraph about tide pools, request ${index}.` }],
            settings: { maxOutputTokens: fixtureSource.maxOutputTokens } }, { signal: new AbortController().signal, requestApproval: async () => true });
          await settled(result.serviceCredit.id);
          settlements.push(await ledgerTrace(coordinator.credits, result.serviceCredit.id));
        }, limits.phaseMs);
      }
      await step('earn close whole model', () => earner.call('close'));
      receipt.earn = { mode: 'whole-model', modelId: earnModel.id, earner: config.earner.participantId, accountId, buyerAccountId: 'computer-buyer',
        accountBefore: before, settlements, accountAfter: balanceOfAccount(accountId) };
    }

    // 2. Open the four stages and the requester, then wait for the route.
    const threadId = 'northstar-split-' + randomUUID();
    const shared = { signalingUrl: coordinator.signalingUrl, roomId: coordinator.roomId, roomToken: coordinator.roomToken, serviceUrl: coordinator.serviceUrl,
      serviceCa: coordinator.serviceCa, maxOutputTokens: fixtureSource.maxOutputTokens, gateHoldMs: limits.phaseMs, edges: true };
    const witness = { threadId, requesterId: config.requester.participantId, stageParticipants: config.stages.map(stage => stage.participantId) };
    for (const [index, stage] of config.stages.entries()) {
      const edge = index === 0 || index === config.stages.length - 1;
      // A requester-held edge stage signs the requester's own account as its payout account; an operator stage signs its own.
      await step(`open stage ${stage.label}`, () => s(stage.label).call('open', { ...shared, stageIndex: index, modelDirectory: stage.stageDirectory,
        accountId: stage.role === 'requester' ? `owner-${requesterAccount}` : `owner-${stage.label}`,
        stateDirectory: stage.stateDirectory, assignedRanges: inventory.stages[index].ranges, capabilityRemap: stage.capabilityRemap === true,
        ...(stage.prefillTokenChunkSize ? { prefillTokenChunkSize: stage.prefillTokenChunkSize } : {}),
        ...(edge ? { fixtureBase64: fixtureBytes.toString('base64'), fixtureSha256, witness } : { witness: null }) }), limits.phaseMs);
    }
    const ownStages = config.stages.filter(stage => stage.role === 'requester').map(stage => stage.participantId);
    await step('open requester', () => s(config.requester.label).call('open', { ...shared, accountId: `owner-${requesterAccount}`, stageIndex: null, modelDirectory: config.requester.modelDirectory,
      stateDirectory: config.requester.stateDirectory, ownStages }));
    // While the route comes up, each participant's own state is logged every 20 s, so a stage that never joins is named.
    let lastDiagnosis = 0;
    const diagnose = async () => {
      if (now() - lastDiagnosis < 20000) return;
      lastDiagnosis = now();
      for (const target of [...config.stages, config.requester]) {
        const row = await s(target.label).call('diagnose', {}, { timeoutMs: 10000 }).catch(error => ({ error: String(error?.message ?? error) }));
        log(`${stamp()} diagnose ${target.label} ${redactor.text(JSON.stringify(row))}`);
        receipt.routeDiagnosis = [...(receipt.routeDiagnosis ?? []), { at: stamp(), label: target.label, state: row }].slice(-40);
      }
    };
    await step('route ready', timeoutMs => until(async () => { const ready = (await s(config.requester.label).call('state')).ready; if (!ready) await diagnose(); return ready; },
      { timeoutMs, label: 'a ready route', pollMs: 500 }), limits.routeReadyMs ?? limits.phaseMs);

    // 3. Spend: one request through reploid/inference with confidentiality 'requester-edges'.
    const accountId = `computer-${requesterAccount}`, before = balanceOfAccount(accountId);
    let answer;
    try {
      answer = await step('split generate (requester-edges)', () => s(config.requester.label).call('generate-edges',
        { messages: fixtureSource.messages, threadId, maxOutputTokens: fixtureSource.maxOutputTokens }, { timeoutMs: limits.phaseMs }), limits.phaseMs);
    } catch (error) {
      // Which boundary failed: each stage's own state, notes and what its resident had executed.
      receipt.failure = { at: stamp(), stages: await Promise.all([...config.stages, config.requester].map(async target => ({ label: target.label,
        diagnose: await s(target.label).call('diagnose', {}, { timeoutMs: 10000 }).catch(cause => ({ error: String(cause?.message ?? cause) })),
        visibility: target === config.requester ? null : await s(target.label).call('visibility', {}, { timeoutMs: 10000 }).then(row => Object.fromEntries(
          Object.entries(row.rows).map(([id, rows]) => [id, { ...summarizeVisibility(rows), failures: rows.filter(item => item.op === 'step-failed') }]))).catch(cause => ({ error: String(cause?.message ?? cause) })) }))) };
      for (const row of receipt.failure.stages) log(`${stamp()} failure ${row.label} ${redactor.text(JSON.stringify(row)).slice(0, 4000)}`);
      throw error;
    }
    await step('split settlement', () => settled(answer.reservationId));
    const first = s(config.stages[0].label), last = s(config.stages.at(-1).label);
    const [input, output] = await step('split witnesses', () => Promise.all([first.call('witness'), last.call('witness')]));
    const { tokenIds } = await step('split final-stage trace', () => last.call('trace', { attemptId: answer.attemptId }));
    const tokens = verifySplitTokens({ fixtureBytes, answer, input, output, tokenIds, roomId: coordinator.roomId, threadId, requesterId: config.requester.participantId });
    const visibility = await step('split visibility', () => Promise.all(config.stages.map(stage => s(stage.label).call('visibility', { attemptId: answer.attemptId }))));
    const loaded = await step('split loader records', () => Promise.all(config.stages.map(stage => s(stage.label).call('loaded'))));
    const settlement = await step('split ledger trace', () => ledgerTrace(coordinator.credits, answer.reservationId));
    const stageSessions = config.stages.map(stage => s(stage.label));
    const settlementReplay = await step('split settlement replay', () => collectSettlementReplay({ requester: s(config.requester.label), stages: stageSessions,
      attemptId: answer.attemptId, policy: coordinator.credits.policy, computerOf: id => accountOf(id) ?? id }));
    receipt.split = { attemptId: answer.attemptId, text: answer.text, cap: fixtureSource.maxOutputTokens, parityExact: tokens.parityExact, tokens: tokens.tokens,
      // The public ledger policy travels with the replay (verify-trade.js reads it), and the route's own step summary
      // with the answer, for per-stage timings.
      route: answer.route, execution: answer.execution ?? null, settlement, settlementReplay: { ...settlementReplay, policy: coordinator.credits.policy }, account: { accountId, before, after: balanceOfAccount(accountId) },
      payouts: settlement.journal.map(row => ({ account: row.accountId, delta: row.delta })),
      inference: { plan: answer.inference.plan, events: answer.inference.events, result: answer.inference.result, admittedRouteId: answer.inference.admittedRouteId } };
    const disclosure = answer.inference.plan.disclosures;
    receipt.privacy = {
      tier: 'requester-edges',
      statement: disclosure.statement,
      contentRecipients: disclosure.contentReadableBy.participants,
      activationRecipients: disclosure.activationsReadableBy?.participants ?? [],
      bindingHops: answer.privacyBinding.route.hops,
      stages: config.stages.map((stage, index) => ({ label: stage.label, stageIndex: index, role: stage.role, participantId: stage.participantId,
        layerRange: inventory.stages[index].layerRange, visibility: summarizeVisibility(visibility[index].rows),
        loaded: loaded[index] })),
      requesterSentContentTo: [config.stages[0].participantId],
      whoCouldRead: [
        { who: 'requester machine (requester, stage 0, stage 3)', reads: 'prompt and answer text, token IDs, all activations, weights of stages 0 and 3' },
        ...config.stages.filter(stage => stage.role === 'operator').map(stage => ({ who: `${stage.label} operator`, reads: 'intermediate activations at its stage boundary (in and out), token counts, step timing, generation settings, signed settlement records with textless output chains, its own layer weights' })),
        { who: 'earner (requester account)', reads: 'the buyer\'s earn prompts and its own answers, never the split request' },
        { who: 'ledger and signaling (operator machine)', reads: 'model identity, participant identities, timing, sizes, reservation and settlement records' }
      ],
      residualRisks: ['Activation inversion: an operator stage holds plaintext hidden states of every prompt and answer token and may reconstruct content from them.',
        'Edge-device ownership is declared by the operator in the host file; Reploid does not verify it.',
        'Middle stages learn the prompt length and the answer length (token counts and step count).',
        'No independent security review has examined this tier.'] };

    // 5. A requester-signed Stop partway. The final stage (requester-held) is held at `stopAtStep`; once the requester has
    // output, it signs its stop at the count it acknowledged and stops. The ledger charges that acknowledged prefix.
    const cases = config.cases ?? {};
    const answerAttempt = async ({ name, gateLabel, gateStep, keepPartial }) => {
      const thread = `northstar-${name}-${randomUUID()}`;
      await s(gateLabel).call('arm-gate', { threadId: thread, step: gateStep });
      const answering = { finished: false, result: null, error: null };
      answering.promise = s(config.requester.label).call('generate-edges', { messages: fixtureSource.messages, threadId: thread,
        maxOutputTokens: fixtureSource.maxOutputTokens, keepPartial }, { timeoutMs: limits.phaseMs })
        .then(value => { answering.result = value; }, error => { answering.error = String(error?.message ?? error); })
        .finally(() => { answering.finished = true; });
      const progress = await until(async () => {
        if (answering.finished) throw Error(`${name}: the answer ended before the gate held it (${answering.error ?? 'completed'})`);
        const [gate, seen] = await Promise.all([s(gateLabel).call('gate-state', { threadId: thread }), s(config.requester.label).call('progress')]);
        return gate.entered && seen.deltas >= 1 && seen.attemptId ? seen : null;
      }, { timeoutMs: limits.phaseMs, label: `${name}: the gate`, pollMs: 250 });
      return { thread, answering, progress };
    };
    const caseVisibility = async (attemptId, labels) => Object.fromEntries(await Promise.all(config.stages.filter(stage => labels.includes(stage.label))
      .map(async stage => [stage.label, summarizeVisibility((await s(stage.label).call('visibility', { attemptId })).rows)])));
    if (cases.stop !== false) {
      const before = balanceOfAccount(accountId);
      const held = await step('stop: answer to the gate', () => answerAttempt({ name: 'stop', gateLabel: config.stages.at(-1).label,
        gateStep: cases.stopAtStep ?? 8 }), limits.phaseMs);
      await step('stop: requester signs its stop', () => s(config.requester.label).call('cancel'));
      await step('stop: answer returns', () => held.answering.promise);
      const own = await s(config.requester.label).call('settlement-records', { attemptId: held.progress.attemptId });
      const reservationId = own.reservationId ?? own.terms?.reservationId;
      await step('stop: settlement', () => settled(reservationId));
      const settlement = await step('stop: ledger trace', () => ledgerTrace(coordinator.credits, reservationId));
      const replay = await step('stop: settlement replay', () => collectSettlementReplay({ requester: s(config.requester.label), stages: config.stages.map(stage => s(stage.label)),
        attemptId: held.progress.attemptId, policy: coordinator.credits.policy, computerOf: id => accountOf(id) ?? id }));
      receipt.cancel = { attemptId: held.progress.attemptId, gate: { stage: config.stages.at(-1).label, step: cases.stopAtStep ?? 8 },
        stoppedBeforeCompletion: held.answering.result?.completed === false && held.answering.result?.stopped === true,
        outputsReceived: own.received?.deltas ?? null, stopSigned: Boolean(own.stop), settlement, settlementReplay: { ...replay, policy: coordinator.credits.policy },
        account: { accountId, before, after: balanceOfAccount(accountId) }, inferenceStatus: held.answering.result?.inference?.result?.status ?? null,
        visibility: await caseVisibility(held.progress.attemptId, config.stages.map(stage => stage.label)) };
    }

    // 5b. A disconnect: no signed stop and no provider failure. The final stage (requester-held) is held at
    // `disconnectAtStep`; once the requester has output it stops asking and signs nothing. Every stage then closes the
    // unfinished answer, and the v2 rule charges the acknowledged prefix as an unattributed disconnect.
    if (cases.disconnect !== false) {
      const before = balanceOfAccount(accountId), gateStep = cases.disconnectAtStep ?? 8;
      const held = await step('disconnect: answer to the gate', () => answerAttempt({ name: 'disconnect', gateLabel: config.stages.at(-1).label,
        gateStep, keepPartial: true }), limits.phaseMs);
      const attemptId = held.progress.attemptId;
      await step('disconnect: requester stops asking, signs nothing', () => s(config.requester.label).call('disconnect'));
      await step('disconnect: answer returns', () => held.answering.promise);
      const own = await s(config.requester.label).call('settlement-records', { attemptId });
      const reservationId = own.reservationId ?? own.terms?.reservationId;
      await step('disconnect: settlement', () => settled(reservationId));
      const settlement = await step('disconnect: ledger trace', () => ledgerTrace(coordinator.credits, reservationId));
      const replay = await step('disconnect: settlement replay', () => collectSettlementReplay({ requester: s(config.requester.label), stages: config.stages.map(stage => s(stage.label)),
        attemptId, policy: coordinator.credits.policy, computerOf: id => accountOf(id) ?? id }));
      // Each stage's own signed closing receipt: which stages closed, with what status, and when.
      const closes = replay.records.filter(row => row?.schema === 'reploid.stage-receipt/v1' && row.attemptId === attemptId && row.timing?.closedAt)
        .map(row => ({ partitionIndex: row.partitionIndex, participantId: row.participantId, status: row.status, closedAt: row.timing.closedAt }));
      receipt.disconnect = { attemptId, gate: { stage: config.stages.at(-1).label, step: gateStep },
        how: 'The requester aborted its own request with a plain reason: no stop was signed and no stage was killed.',
        disconnected: own.disconnected ?? null, stopSigned: Boolean(own.stop),
        completed: held.answering.result?.completed === true, outputsReceived: own.received?.deltas ?? null, requesterOutcome: own.outcome,
        stageCloses: closes, settlement, settlementReplay: { ...replay, policy: coordinator.credits.policy },
        account: { accountId, before, after: balanceOfAccount(accountId) }, inferenceStatus: held.answering.result?.inference?.result?.status ?? null,
        visibility: await caseVisibility(attemptId, config.stages.map(stage => stage.label)) };
    }

    // 6. A dropped stage host partway, no stop. The named operator stage is held at `dropAtStep`; each stage signs its
    // acceptance and the dropped stage hands over its step receipts; then its process is killed by exact PID. With no
    // closing receipt from it, the ledger and the replay give verified-provider-failure relief after the release window.
    if (cases.drop !== false) {
      const target = config.stages.find(stage => stage.label === (cases.dropStage ?? 'host-c'));
      if (!target || target.role !== 'operator') throw Error('The dropped stage must be an operator stage');
      const before = balanceOfAccount(accountId), dropped = s(target.label), index = config.stages.indexOf(target);
      const held = await step('drop: answer to the gate', () => answerAttempt({ name: 'drop', gateLabel: target.label, gateStep: cases.dropAtStep ?? 8, keepPartial: true }), limits.phaseMs);
      const attemptId = held.progress.attemptId;
      const { terms } = await s(config.requester.label).call('settlement-records', { attemptId });
      const acceptances = await step('drop: acceptances', () => Promise.all(config.stages.map(stage => s(stage.label).call('accept-terms', { terms })
        .catch(error => ({ error: String(error?.message ?? error) })))));
      const droppedRecords = await step('drop: dropped stage records', () => dropped.call('settlement-records', { attemptId }));
      const visibilityBefore = await caseVisibility(attemptId, [target.label]);
      const exact = { pid: dropped.pid, startId: dropped.startId };
      const killed = await step('drop: kill the stage process', async () => {
        const result = await control(target, 'kill', exact);
        await until(async () => !(await control(target, 'process-state', exact)).running, { timeoutMs: 20000, label: 'the killed process to be gone', pollMs: 250 });
        return { host: target.label, how: 'exact-process-kill', signalled: result.killed === true, confirmedGone: true, at: stamp() };
      });
      sessions.delete(target.label);
      const reservationId = terms?.reservationId ?? `service:${config.requester.participantId}:${attemptId}`;
      const { maxRequestMs, partitionUnclaimedReleaseMs } = coordinator.credits.policy;
      await step('drop: hold expiry', () => until(() => { coordinator.credits.snapshot(); return coordinator.credits.request(reservationId)?.state === 'settled'; },
        { timeoutMs: maxRequestMs + partitionUnclaimedReleaseMs + 30000, label: 'the dropped hold to expire', pollMs: 1000 }), maxRequestMs + partitionUnclaimedReleaseMs + 60000);
      const own = await s(config.requester.label).call('settlement-records', { attemptId });
      const settlement = await step('drop: ledger trace', () => ledgerTrace(coordinator.credits, reservationId));
      const replay = await step('drop: settlement replay', () => collectSettlementReplay({ requester: s(config.requester.label),
        stages: config.stages.map(stage => (stage === target ? null : s(stage.label))), attemptId, policy: coordinator.credits.policy,
        computerOf: id => accountOf(id) ?? id, acceptancesSigned: 'during-attempt',
        prefetched: { acceptances, stageRecords: config.stages.map((_, position) => (position === index ? droppedRecords : null)) } }));
      receipt.drop = { attemptId, gate: { stage: target.label, step: cases.dropAtStep ?? 8 }, killed, outputsBeforeKill: held.progress.deltas,
        outputsReceived: own.received?.deltas ?? null, stopSigned: Boolean(own.stop), requesterOutcome: own.outcome, settlement,
        settlementReplay: { ...replay, policy: coordinator.credits.policy }, account: { accountId, before, after: balanceOfAccount(accountId) },
        visibility: { ...visibilityBefore, ...(await caseVisibility(attemptId, config.stages.filter(stage => stage !== target).map(stage => stage.label))) },
        // Which rule decided the relief, from the requester's signed terms; the receipt states it rather than resolving it.
        reliefRule: { unfinishedTerms: terms?.unfinishedTerms ?? null,
          appliedRule: 'A stage named in the terms has no counting close after the release window and the answer was not delivered: the attempt expires, nobody is charged or paid.',
          ...(cases.reliefNote ? { note: cases.reliefNote } : {}) } };
    }

    // 4. Close everything and confirm no hold is open.
    const closed = await step('close sessions', () => Promise.all([...sessions.values()].map(session => session.call('close', {}, { timeoutMs: 20000 }).then(() => true, () => false))));
    receipt.cleanup = { processesExited: closed.every(Boolean), heldCredits: coordinator.credits.snapshot().accounts.reduce((sum, row) => sum + row.held, 0),
      openReservations: await openReservationCount(coordinator.ledgerFile) };
  } catch (error) {
    receipt.error = redactor.text(error?.message ?? error);
  } finally {
    for (const session of sessions.values()) { try { session.end(); } catch { /* already ended */ } }
    await coordinator?.close().catch(() => {});
    receipt.finishedAt = stamp();
  }
  const cases = config.cases ?? {};
  receipt.verdict = checkNorthStar(receipt, { reference, weights, cases: ['stop', 'disconnect', 'drop'].filter(name => cases[name] !== false) });
  receipt.notEstablished = [
    'An independent security review of the requester-edges tier (a visibility trace is not one).',
    'Confidentiality from operators: they read plaintext activations; "nobody can read it" remains a target and requester-only still fails closed.',
    'Separate operators: one person owns every machine; the accounts are separate only on the ledger.',
    'Capacity beyond one machine: the requester machine fit this model alone in Stage 1, and no solo or CPU-offload control ran here.',
    'Outsider reproduction: the replay ran in this harness from the participants\' signed records, not on an outsider\'s machine.'];
  return redactor.receipt(receipt);
}

async function main() {
  const { values } = parseArgs({ options: { hosts: { type: 'string' }, fixture: { type: 'string' }, 'window-until': { type: 'string' },
    work: { type: 'string' }, out: { type: 'string' } } });
  if (!values.hosts || !values.fixture || !values['window-until'] || !values.work || !values.out) {
    throw Error('Usage: north-star.js --hosts PRIVATE_FILE --fixture REFERENCE.json --window-until ISO_TIME --work DIRECTORY --out RECEIPT.json');
  }
  const config = JSON.parse(await fs.readFile(values.hosts, 'utf8'));
  const receipt = await runNorthStar({ config, transport: createSshTransport(), directory: path.resolve(values.work), fixtureFile: path.resolve(values.fixture),
    windowUntil: values['window-until'], log: line => process.stderr.write(line + '\n') });
  await fs.writeFile(values.out, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  process.stderr.write(`verdict: ${receipt.verdict.passed ? 'passed' : 'failed'}${receipt.verdict.problems.map(row => `\n  ${row.code}: ${row.detail}`).join('')}\n`);
  if (!receipt.verdict.passed) process.exitCode = 1;
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) {
  try { await main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
