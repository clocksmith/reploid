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

/** Per stage: what its resident was handed over the whole answer, from its own visibility rows. */
export function summarizeVisibility(rows) {
  const steps = rows.filter(row => row.op === 'step');
  return { tokenizeCalls: rows.filter(row => row.op === 'tokenize').length, steps: steps.length,
    tokenContext: [...new Set(steps.map(row => row.tokenContext))],
    tokenIdsReceived: steps.reduce((sum, row) => sum + (row.tokenIds?.count ?? 0), 0),
    nonzeroTokenIdsReceived: steps.reduce((sum, row) => sum + (row.tokenIds?.nonzero ?? 0), 0),
    activationBytesIn: steps.reduce((sum, row) => sum + row.activationInBytes, 0),
    activationBytesOut: steps.reduce((sum, row) => sum + row.activationOutBytes, 0),
    tokensOut: steps.filter(row => row.output === 'token').length,
    deltaCharactersOut: steps.reduce((sum, row) => sum + row.deltaCharacters, 0) };
}

/** The checks, each named. `fail` collects; nothing short-circuits so the receipt shows every problem at once. */
export function checkNorthStar(receipt, { reference, weights, creditsPerOutputToken = 1 }) {
  const problems = [], fail = (code, detail) => problems.push({ code, detail: String(detail) });
  const earn = receipt.earn, split = receipt.split, privacy = receipt.privacy;
  // 1. Earn by serving someone else.
  if (!earn) fail('earn-missing', 'no earning');
  else {
    if (earn.accountBefore !== 0) fail('earn-seeded-balance', earn.accountBefore);
    let earned = 0;
    for (const [index, trace] of (earn.settlements ?? []).entries()) {
      if (trace.state !== 'settled' || trace.heldAfter !== 0) fail('earn-not-settled', `earn-${index} ${trace.state}`);
      if (trace.journal.reduce((sum, row) => sum + row.delta, 0) !== 0) fail('settlement-not-conserved', `earn-${index}`);
      const credited = trace.journal.filter(row => row.accountId === earn.accountId).reduce((sum, row) => sum + row.delta, 0);
      if (credited !== trace.charge || trace.charge !== trace.outputTokens * creditsPerOutputToken) fail('earn-not-credited', `earn-${index}`);
      if (trace.replay?.attempted !== true || trace.replay.balancesUnchanged !== true) fail('double-settlement', `earn-${index}`);
      earned += credited;
    }
    if (earned <= 0) fail('earn-nothing', earned);
    if (earn.buyerAccountId === earn.accountId) fail('earn-self-served', earn.buyerAccountId);
  }
  // 2. Spend those credits on the split, within the cap.
  const trace = split?.settlement;
  if (!trace) fail('split-settlement-missing', 'no ledger trace');
  else {
    if (trace.state !== 'settled' || trace.heldAfter !== 0) fail('stranded-hold', `${trace.state} held ${trace.heldAfter}`);
    if (trace.journal.reduce((sum, row) => sum + row.delta, 0) !== 0) fail('settlement-not-conserved', 'split');
    const debits = trace.journal.filter(row => row.delta < 0);
    if (debits.length !== 1 || debits[0].accountId !== split.account.accountId) fail('double-settlement', JSON.stringify(debits));
    if (trace.charge !== trace.outputTokens * creditsPerOutputToken || trace.charge > split.cap) fail('settlement-charge', `${trace.charge} for ${trace.outputTokens}, cap ${split.cap}`);
    if (!(split.account.before >= trace.charge)) fail('spend-before-earning', `balance ${split.account.before}, charge ${trace.charge}`);
    const net = trace.journal.filter(row => row.accountId === split.account.accountId).reduce((sum, row) => sum + row.delta, 0);
    if (split.account.after !== split.account.before + net) fail('spend-mismatch', `${split.account.before} + ${net} != ${split.account.after}`);
    const total = weights.reduce((sum, value) => sum + value, 0);
    if (trace.credits.length !== weights.length) fail('settlement-shares', JSON.stringify(trace.credits));
    if (trace.replay?.attempted !== true || trace.replay.balancesUnchanged !== true || trace.replay.outcomeUnchanged !== true) fail('double-settlement', 'split replay changed the ledger');
    if (!(total > 0)) fail('settlement-shares', 'weights');
  }
  // 3. The independent replay from signed records equals the ledger.
  const replay = split?.settlementReplay, row = replay?.result?.reservations?.find(item => item.reservationId === trace?.reservationId);
  if (!row) fail('replay-reservation-missing', 'split');
  else {
    if (row.status !== 'settled') fail('replay-not-settled', row.status);
    if (row.debit !== trace.charge || JSON.stringify((row.credits ?? []).map(item => item.amount)) !== JSON.stringify(trace.credits.map(item => item.amount))) {
      fail('replay-differs-from-ledger', `replay ${row.debit} ${JSON.stringify(row.credits)} ledger ${trace.charge} ${JSON.stringify(trace.credits)}`);
    }
    if (replay.problems?.length) fail('replay-records', replay.problems.join('; '));
    if (!replay.ledgerPolicyDigest || replay.termsPolicyDigest !== replay.ledgerPolicyDigest) fail('replay-policy-mismatch', replay.termsPolicyDigest);
  }
  // 4. The answer matches the frozen single-host reference, token for token.
  if (!split?.tokens || witnessDigest(split.tokens.outputIds) !== reference.sampleDigest) fail('answer-tokens-differ', 'output tokens differ from the reference');
  if (split?.parityExact !== true) fail('answer-witness', 'the stage witnesses do not verify');
  if (split?.text !== reference.outputText) fail('answer-text-differs', 'answer text differs from the reference text');
  // 5. The privacy tier: named, bound before disclosure, and observed at every stage.
  const evidence = split?.inference?.result?.executionReceipt?.evidence?.confidentiality;
  if (evidence?.mode !== 'requester-edges') fail('tier-not-named', evidence?.mode);
  if (privacy) {
    for (const stage of privacy.stages) {
      const seen = stage.visibility;
      if (stage.role === 'operator') {
        if (seen.nonzeroTokenIdsReceived !== 0 || seen.tokenizeCalls !== 0 || seen.tokensOut !== 0 || seen.deltaCharactersOut !== 0
          || seen.tokenContext.some(value => value !== 'withheld')) fail('operator-saw-content', `${stage.label} ${JSON.stringify(seen)}`);
        if (!(seen.steps > 0 && seen.activationBytesIn > 0)) fail('operator-did-not-run', stage.label);
        if (stage.hostWeights?.servedOutsideStage) fail('stage-weights', stage.label);
      }
    }
    const operatorIds = privacy.stages.filter(stage => stage.role === 'operator').map(stage => stage.participantId);
    if (operatorIds.some(id => privacy.contentRecipients.includes(id))) fail('operator-content-recipient', 'an operator stage is a content recipient');
    if (privacy.bindingHops.some(hop => operatorIds.includes(hop.recipient) && hop.disclosure !== 'activations')) fail('operator-hop', 'an operator hop reads plaintext content');
  } else fail('privacy-trace-missing', 'no visibility trace');
  if (receipt.cleanup?.processesExited !== true || receipt.cleanup?.openReservations !== 0 || receipt.cleanup?.heldCredits !== 0) {
    fail('cleanup', JSON.stringify(receipt.cleanup));
  }
  return { passed: problems.length === 0, problems };
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
    participants: null, earn: null, split: null, privacy: null, cleanup: null, steps, error: null, verdict: null };

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
      await step(`open stage ${stage.label}`, () => s(stage.label).call('open', { ...shared, stageIndex: index, modelDirectory: stage.stageDirectory,
        stateDirectory: stage.stateDirectory, assignedRanges: inventory.stages[index].ranges, capabilityRemap: stage.capabilityRemap === true,
        ...(edge ? { fixtureBase64: fixtureBytes.toString('base64'), fixtureSha256, witness } : { witness: null }) }), limits.phaseMs);
    }
    const ownStages = config.stages.filter(stage => stage.role === 'requester').map(stage => stage.participantId);
    await step('open requester', () => s(config.requester.label).call('open', { ...shared, stageIndex: null, modelDirectory: config.requester.modelDirectory,
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
    const answer = await step('split generate (requester-edges)', () => s(config.requester.label).call('generate-edges',
      { messages: fixtureSource.messages, threadId, maxOutputTokens: fixtureSource.maxOutputTokens }, { timeoutMs: limits.phaseMs }), limits.phaseMs);
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
      route: answer.route, settlement, settlementReplay, account: { accountId, before, after: balanceOfAccount(accountId) },
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
  receipt.verdict = checkNorthStar(receipt, { reference, weights });
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
