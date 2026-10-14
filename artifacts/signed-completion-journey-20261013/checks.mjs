// Requester journey checks, generalized from
// artifacts/signed-host-opener-20261012/requester-return-control/checks.mjs to N ordered stages.
// Every precedent requirement is retained; two-device fields are replaced by the
// ordered summary (identity.route.stages, cleanup rows {partitionIndex,status,error}).
import { isDeepStrictEqual } from 'node:util';
import { timingRecordFailures } from './timing.mjs';

export const ORDERED_DISCLOSURE = 'ordered-partition-activations-and-tokens';

export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

export function projectHistory(observation) {
  if (!Array.isArray(observation?.threads)) return null;
  return observation.threads.map(thread => ({
    id: thread.id, modelIdentity: thread.model.identity,
    messages: thread.messages, attempts: thread.attempts
  }));
}
export function emptyCustody(value) {
  return value?.state?.receivedBytes === 0 && value.state.verifiedFiles?.length === 0
    && value.receipts?.length === 0 && value.state.pending === 0
    && !value.state.preparing && !value.state.sharing;
}

function checker() {
  const failures = [];
  return { failures, require(ok, reason) { if (!ok) failures.push(reason); } };
}
const responseOf = (thread, attempt) => thread?.messages?.find(message => message.id === attempt?.responseId);

/** The executed route must be exactly the frozen ordered route, with the requester outside it. */
export function orderedRouteFailures(execution, freeze, label) {
  const { failures, require } = checker();
  const identity = execution?.identity, route = identity?.route;
  const stages = Array.isArray(route?.stages) ? route.stages : [];
  const contributors = stages.map(stage => stage?.participantId);
  require(execution?.schema === 'reploid.mesh.partition-summary/v2', `${label} ordered execution summary unobserved (hidden local, whole-request or two-device fallback)`);
  require(identity?.schema === 'reploid.partition-attempt/v2' && route?.schema === 'reploid.partition-route/v1', `${label} ordered route identity unobserved`);
  require(route?.modelId === freeze.modelId && route?.modelIdentity === freeze.modelIdentity && route?.planId === freeze.planId,
    `${label} route binds a different model or plan than the freeze`);
  require(stages.length === freeze.route.length && contributors.every(Boolean) && new Set(contributors).size === freeze.route.length,
    `${label} distinct route contributors (${new Set(contributors.filter(Boolean)).size}) differ from the frozen route (${freeze.route.length})`);
  require(freeze.route.every((frozen, index) => stages[index]?.index === index && stages[index]?.participantId === frozen.participantId),
    `${label} route stages differ from the frozen stage order`);
  require(typeof identity?.requesterId === 'string' && !contributors.includes(identity.requesterId), `${label} requester was assigned a stage`);
  return failures;
}

/** Every stage of a completed attempt must be admitted, executed for every step and settled. */
export function settlementFailures(execution, stageCount, label) {
  const { failures, require } = checker();
  const settlement = execution?.settlement, rows = settlement?.cleanup;
  require(Array.isArray(rows) && rows.length === stageCount
    && Array.from({ length: stageCount }, (_, index) => rows.filter(row => row?.partitionIndex === index)).every(found => found.length === 1),
  `${label} cleanup rows do not cover every stage exactly once`);
  require(Array.isArray(rows) && rows.length > 0 && rows.every(row => row?.status === 'settled' && row.error === null), `${label} cleanup not confirmed: a cleanup row is unsettled`);
  require(settlement?.phase === 'completed' && Number.isFinite(settlement.cleanupSettledAt) && settlement.failure === null,
    `${label} settlement phase not completed`);
  require(Array.isArray(settlement?.reservations) && settlement.reservations.length === stageCount
    && settlement.reservations.every((row, index) => row?.partitionIndex === index && row.status === 'reserved'), `${label} not every stage was admitted`);
  const summary = execution?.stepSummary;
  require(Number.isSafeInteger(summary?.count) && summary.count > 0 && Array.isArray(summary.stages) && summary.stages.length === stageCount
    && summary.stages.every((row, index) => row.partitionIndex === index && row.steps === summary.count), `${label} not every stage executed every step`);
  return failures;
}

export function completedAttemptFailures(thread, attempt, freeze, label) {
  const response = responseOf(thread, attempt);
  const failures = [];
  if (!(attempt?.status === 'completed' && response?.status === 'completed')) failures.push(`${label} not complete`);
  if (attempt?.execution?.stopReason !== 'eos-token') failures.push(`${label} natural EOS unobserved`);
  failures.push(...orderedRouteFailures(attempt?.execution, freeze, label));
  failures.push(...settlementFailures(attempt?.execution, freeze.route.length, label));
  return failures;
}

/** The first remote request of each fresh profile showed the one-time contributor permission
 * (self/ui/pool-home/remote-permission.js), which the harness recorded and allowed (harness.mjs allowPermission).
 * Every later request is sent without asking. Each attempt's stored authorization must cite a recorded permission
 * (permissionId) whose screen explained what is sent and who receives it, and whose stored scope covers this
 * ordered disclosure, sharing scope and model. Its recipients must be the frozen route the attempt was dispatched to. */
export function approvalFailures(attempt, freeze, label, permissions = []) {
  const { failures, require } = checker();
  const auth = attempt?.authorization, stages = Array.isArray(auth?.route?.stages) ? auth.route.stages : [];
  const frozen = freeze.route.map(stage => stage.participantId);
  const shown = (permissions || []).find(row => row?.stored?.id && row.stored.id === auth?.permissionId);
  require(auth?.source === 'permission' && auth.kind === 'permission', `${label} was not sent under the stored contributor permission`);
  require(!!shown, `${label} cites no recorded contributor permission`);
  require(shown?.stored?.disclosure === ORDERED_DISCLOSURE && shown.stored.sharingScope === auth?.sharingScope
    && shown.stored.modelIdentities?.includes(freeze.modelIdentity) && shown.need?.disclosure === ORDERED_DISCLOSURE,
  `${label} permission does not cover this ordered disclosure, sharing scope and model`);
  require(/earlier messages/.test(shown?.what ?? '') && /context prompt/.test(shown?.what ?? '') && /this network/.test(shown?.what ?? ''),
    `${label} permission screen did not say the conversation, earlier messages and context prompt are sent to this network`);
  require(/first computer receives the text/.test(shown?.who ?? '') && /model tokens, which read back as text/.test(shown?.who ?? '')
    && /intermediate results/.test(shown?.who ?? ''), `${label} permission screen did not say who receives the text, tokens and intermediate results`);
  require(isDeepStrictEqual(auth?.recipients, frozen), `${label} recorded recipients differ from the frozen route`);
  require(isDeepStrictEqual(auth?.recipients, (attempt?.execution?.identity?.route?.stages || []).map(stage => stage.participantId)),
    `${label} recorded recipients differ from the route it was dispatched to`);
  require(auth?.disclosure === ORDERED_DISCLOSURE, `${label} approval does not cover ordered activations and tokens`);
  require(stages.length === freeze.route.length && freeze.route.every((frozen, index) => stages[index]?.participantId === frozen.participantId),
    `${label} approved recipients differ from the frozen route`);
  require(auth?.recipientIdentity === freeze.route[0].participantId && auth?.peerId === freeze.route[0].participantId,
    `${label} approval is not addressed to the stage 0 coordinator`);
  require(auth?.modelIdentity === freeze.modelIdentity && auth?.planId === freeze.planId, `${label} approval binds another model or plan`);
  require(!!auth?.route && canonicalJson(auth.route) === canonicalJson(attempt?.execution?.identity?.route), `${label} executed route differs from the approved route`);
  require(typeof auth?.requesterIdentity === 'string' && !stages.some(stage => stage?.participantId === auth.requesterIdentity),
    `${label} requester approved itself as a stage`);
  return failures;
}

const counted = text => (String(text || '').match(/\d+/g) || []).map(Number);
const run = (fn) => { try { return fn(); } catch (error) { return [`observation missing or malformed: ${error.message}`]; } };

function openFailures(report, freeze) {
  const { failures, require } = checker(), open = report.open;
  require(open?.servedDescriptor === freeze.browserBundle, 'Served bundle descriptor differs from the frozen browser bundle');
  require(open?.ready === true, 'Application never reported a ready ordered model');
  require(Array.isArray(open?.initialState?.threads) && open.initialState.threads.every(thread => thread.attempts.length === 0), 'Fresh requester unexpectedly contains attempts');
  require(open?.orderedParticipation && !open.orderedParticipation.error && open.orderedParticipation.stage === null,
    'Requester did not enter ordered mode with stage: null');
  require(open?.network && open.network.sharing === false && open.network.contribution?.offering !== true, 'Requester is contributing compute');
  return failures;
}

function modelChoiceFailures(report, freeze, selectionId) {
  const { failures, require } = checker();
  require(report.modelChoice?.selectedValue === selectionId, 'The frozen ordered model was not chosen through the model control');
  for (const [index, thread] of (report.turns || []).entries()) {
    const partition = thread.model?.partition;
    require(thread.model?.identity === freeze.modelIdentity && partition?.schema === 'reploid.partition-selection/v2'
      && partition.planId === freeze.planId, `Turn${index + 1} thread model differs from the frozen ordered selection`);
  }
  require((report.turns || []).length > 0, 'No chosen-model conversation observed');
  return failures;
}

function selectiveAcquisitionFailures(report) {
  const { failures, require } = checker();
  require(Array.isArray(report.weights) && report.weights.length === 0, 'Requester tabs issued weight HTTP requests');
  require([report.custodyBefore, report.custodyAfter, report.custodyAfterReload].every(emptyCustody), 'Requester received or retained weights, or custody evidence is missing');
  const tabs = report.concurrency?.tabs || [];
  require(tabs.length > 0 && tabs.every(tab => emptyCustody(tab.custodyAfter)), 'A concurrent requester tab received weights or lacks custody evidence');
  require(emptyCustody(report.retry?.custodyAfter), 'Retry requester tab received weights or lacks custody evidence');
  return failures;
}

function conversationFailures(report, fixture, freeze) {
  const { failures, require } = checker();
  require(report.turns?.length === 2, 'Two completed turns required');
  const first = report.turns?.[0], second = report.turns?.[1];
  if (!(first && second)) {
    const missing = ['Two completed turns required'];
    return { completion: failures, followUp: missing, streaming: missing, copy: missing };
  }
  const followUp = checker(), streaming = checker(), copy = checker();
  followUp.require(first.id === second.id, 'Follow-up must use the same conversation');
  const a = first.attempts.at(-1), b = second.attempts.at(-1);
  followUp.require(a.id !== b.id && second.attempts.length === first.attempts.length + 1, 'Exactly one new follow-up attempt required');
  for (const [index, thread] of report.turns.entries()) failures.push(...completedAttemptFailures(thread, thread.attempts.at(-1), freeze, `Turn${index + 1}`));
  const response = responseOf(first, a);
  const expected = [{ role: 'user', content: fixture.questions[0] }, { role: 'assistant', content: response?.content }, { role: 'user', content: fixture.questions[1] }];
  const actual = b.request?.messages?.filter(message => message.role !== 'system');
  followUp.require(isDeepStrictEqual(actual, expected), 'Actual first answer missing or changed in ordered follow-up');
  const samples = report.streamSamples?.filter(row => row.attemptId === a.id && row.messageId === response?.id) || [];
  streaming.require(samples.some(row => row.status !== 'completed' && row.content.length > 0 && row.content.length < response.content.length
    && response.content.startsWith(row.content) && row.renderedText?.length > 0), 'Visible incomplete streamed first-answer prefix unobserved');
  copy.require(report.copy?.messageId === response?.id && report.copy.clipboardText === response?.content, 'Real Copy output differs from stored answer');
  return { completion: failures, followUp: followUp.failures, streaming: streaming.failures, copy: copy.failures };
}

function reloadFailures(report, fixture) {
  const { failures, require } = checker();
  require(report.beforeReload && report.restoredState && isDeepStrictEqual(projectHistory(report.beforeReload), projectHistory(report.restoredState)), 'Reload changed messages or attempts');
  require(report.restoration?.draft === fixture.draft, 'Reload lost unsent draft');
  require(report.returnSamples?.length >= 2 && report.returnSamples.every(sample => sample.runningIds.length === 0 && isDeepStrictEqual(sample.history, projectHistory(report.beforeReload))), 'New/changed attempt observed after reload, or return observations missing');
  require(report.returnObservationMs >= fixture.postRediscoveryObservationMs, 'Bounded redispatch observation incomplete');
  return failures;
}

/** Independent requesters are separate browser profiles, each with its own peer identity: the product
 * route connects one tab per profile (README, "Contract decision"), and never sets a per-tab instance. */
function concurrencyFailures(report, configTabs) {
  const { failures, require } = checker(), c = report.concurrency, tabs = c?.tabs || [];
  const distinct = values => values.every(value => typeof value === 'string' && value.length > 0) && new Set(values).size === values.length;
  require(tabs.length === configTabs && tabs.length >= 2, `Expected ${configTabs} concurrent independent requesters`);
  require(Number.isSafeInteger(c?.servedLimit) && tabs.length <= c.servedLimit, 'Concurrent requests exceed the served route admission limit');
  require(distinct(tabs.map(tab => tab.profile)) && distinct(tabs.map(tab => tab.profileDirectory)),
    'Concurrent requests do not come from separate browser profiles');
  require(distinct(tabs.map(tab => tab.requesterPeerId)), 'Concurrent requesters do not use independent peer identities');
  require(distinct(tabs.map(tab => tab.final?.attempts?.find(attempt => attempt.id === tab.attemptId)?.execution?.identity?.requesterId)),
    'Concurrent attempts were not sent by distinct requesters');
  require(c?.pairedSamples?.some(sample => sample.statuses.length === tabs.length && sample.statuses.every(status => status === 'executing')),
    'Concurrent requests were never executing simultaneously');
  require(tabs.filter(tab => tab.role === 'cancel').length === 1 && tabs.filter(tab => tab.role === 'survivor').length === tabs.length - 1,
    'Exactly one cancelled tab and the rest surviving tabs required');
  return failures;
}

function cancellationFailures(report, fixture, freeze) {
  const { failures, require } = checker(), tabs = report.concurrency?.tabs || [];
  const target = tabs.find(tab => tab.role === 'cancel'), receipts = report.coordinator?.receipts || [];
  const attempt = target?.final?.attempts?.find(item => item.id === target.attemptId);
  const response = responseOf(target?.final, attempt);
  require(!!attempt && attempt.status === 'cancelled' && response?.status === 'cancelled' && attempt.error === 'Response stopped',
    'Stopped request did not settle as a requester cancellation');
  require(typeof target?.contentAtStop === 'string' && target.contentAtStop.length > 0 && response?.content.startsWith(target.contentAtStop),
    'Stopped request did not preserve its visible partial answer');
  require(target?.final?.attempts?.at(-1)?.id === target?.attemptId, 'Stopping started another attempt');
  const receipt = receipts.find(row => row?.identity?.attemptId === target?.attemptId);
  require(receipt?.phase === 'cancelled' && Array.isArray(receipt.cleanup) && receipt.cleanup.length === freeze.route.length
    && receipt.cleanup.every(row => row?.status === 'settled') && Number.isFinite(receipt.cleanupSettledAt),
  'Coordinator did not settle every stage of the cancelled attempt');
  const survivors = tabs.filter(tab => tab.role === 'survivor');
  require(survivors.length > 0, 'No surviving neighbour observed');
  for (const [index, tab] of survivors.entries()) {
    const label = `Neighbour${index + 1}`, last = tab.final?.attempts?.at(-1);
    require(last?.id === tab.attemptId, `${label} attempt was replaced`);
    require(!(tab.samples || []).some(sample => ['cancelling', 'cancelled'].includes(sample.status)), `${label} was cancelled with the stopped request`);
    failures.push(...completedAttemptFailures(tab.final, last, freeze, label));
    require(isDeepStrictEqual(counted(responseOf(tab.final, last)?.content), fixture.concurrency.survivorNumbers), `${label} answer differs from the requested count`);
  }
  return failures;
}

function retryFailures(report, freeze) {
  const { failures, require } = checker(), retry = report.retry;
  const failed = retry?.failed?.attempts?.find(item => item.id === retry?.failedAttemptId);
  const failedResponse = responseOf(retry?.failed, failed);
  require(!!failed && ['interrupted', 'failed', 'cancelled'].includes(failed.status) && failed.error && failed.error !== 'Response stopped',
    'No unsuccessful attempt (other than a user stop) preceded the retry');
  require(typeof retry?.contentBeforeFailure === 'string' && retry.contentBeforeFailure.length > 0 && failedResponse?.content?.length > 0
    && (failedResponse.content.startsWith(retry.contentBeforeFailure) || retry.contentBeforeFailure.startsWith(failedResponse.content)),
  'Failed attempt did not retain its partial answer');
  require(retry?.returnSamples?.length >= 2 && retry.returnSamples.every(sample => sample.runningIds.length === 0 && sample.attemptCount === retry.failed.attempts.length),
    'An attempt was redispatched before the explicit retry');
  const final = retry?.final, last = final?.attempts?.at(-1);
  require(last && last.id !== retry?.failedAttemptId && last.retryOf === retry?.failedAttemptId && final.attempts.length === retry.failed.attempts.length + 1,
    'Explicit retry did not start exactly one new attempt linked to the failure');
  require(isDeepStrictEqual(final?.messages?.slice(0, retry?.failed?.messages?.length), retry?.failed?.messages), 'Retry changed earlier messages or the preserved partial answer');
  failures.push(...completedAttemptFailures(final, last, freeze, 'Retry'), ...approvalFailures(last, freeze, 'Retry', report.permissions));
  const receipt = (report.coordinator?.receipts || []).find(row => row?.identity?.attemptId === retry?.failedAttemptId);
  require(receipt && ['cancelled', 'failed'].includes(receipt.phase) && receipt.cleanup?.length === freeze.route.length
    && receipt.cleanup.every(row => row?.status === 'settled'), 'Coordinator did not settle every stage of the failed attempt');
  return failures;
}

function timingFailures(report, freeze) {
  const required = [...(report.turns || []).map(thread => thread.attempts.at(-1)?.id),
    ...(report.concurrency?.tabs || []).filter(tab => tab.role === 'survivor').map(tab => tab.attemptId), report.retry?.final?.attempts?.at(-1)?.id];
  const failures = [];
  if (required.some(id => !id)) failures.push('A completed answer lacks an attempt identity for timing');
  for (const id of required.filter(Boolean)) {
    const record = (report.timing || []).find(item => item.attemptId === id);
    failures.push(...(record ? timingRecordFailures(record, { requireComplete: true, stageCount: freeze.route.length }) : [`timing ${id}: record missing`]));
  }
  return failures;
}

export const REQUESTER_REQUIREMENTS = Object.freeze({
  open: ['REP-7 docs/roadmap/requirements.md:133', 'ROADMAP.md:28,34'],
  modelChoice: ['REP-7 docs/roadmap/requirements.md:135', 'ROADMAP.md:34'],
  recipientApproval: ['REP-7 docs/roadmap/requirements.md:135,145', 'DR-3 docs/roadmap/requirements.md:417'],
  selectiveAcquisition: ['REP-7 docs/roadmap/requirements.md:133,173'],
  streaming: ['REP-7 docs/roadmap/requirements.md:146,173'],
  completion: ['DR-5 docs/roadmap/requirements.md:190', 'REP-7 docs/roadmap/requirements.md:133,173'],
  followUp: ['REP-7 docs/roadmap/requirements.md:133,173'],
  copy: ['REP-7 docs/roadmap/requirements.md:146,173'],
  reload: ['REP-7 docs/roadmap/requirements.md:147,173', 'DR-5 docs/roadmap/requirements.md:195'],
  concurrency: ['REP-7 docs/roadmap/requirements.md:133', 'DR-5 docs/roadmap/requirements.md:190', 'REP-4 docs/roadmap/requirements.md:272'],
  isolatedCancellation: ['DR-5 docs/roadmap/requirements.md:190', 'REP-7 docs/roadmap/requirements.md:148'],
  explicitRetry: ['DR-5 docs/roadmap/requirements.md:190', 'REP-6 docs/roadmap/requirements.md:406', 'REP-7 docs/roadmap/requirements.md:148'],
  timing: ['ROADMAP.md:14']
});

export function assessJourney(report, fixture, freeze, { selectionId, concurrencyTabs }) {
  const conversation = run(() => conversationFailures(report, fixture, freeze));
  const pick = key => Array.isArray(conversation) ? conversation : conversation[key];
  const results = {
    open: run(() => openFailures(report, freeze)),
    modelChoice: run(() => modelChoiceFailures(report, freeze, selectionId)),
    recipientApproval: run(() => [...(report.turns || []).map((thread, index) => approvalFailures(thread.attempts.at(-1), freeze, `Turn${index + 1}`, report.permissions)).flat(),
      ...(report.concurrency?.tabs || []).filter(tab => tab.role === 'survivor').flatMap((tab, index) => approvalFailures(tab.final?.attempts?.at(-1), freeze, `Neighbour${index + 1}`, report.permissions)),
      ...((report.turns || []).length ? [] : ['No approved attempt observed'])]),
    selectiveAcquisition: run(() => selectiveAcquisitionFailures(report)),
    streaming: pick('streaming'),
    completion: pick('completion'),
    followUp: pick('followUp'),
    copy: pick('copy'),
    reload: run(() => reloadFailures(report, fixture)),
    concurrency: run(() => concurrencyFailures(report, concurrencyTabs)),
    isolatedCancellation: run(() => cancellationFailures(report, fixture, freeze)),
    explicitRetry: run(() => retryFailures(report, freeze)),
    timing: run(() => timingFailures(report, freeze))
  };
  const checks = Object.fromEntries(Object.entries(results).map(([name, failures]) => [name,
    { pass: failures.length === 0, failures, requirements: REQUESTER_REQUIREMENTS[name] }]));
  const failures = Object.entries(checks).flatMap(([name, check]) => check.failures.map(reason => `${name}: ${reason}`));
  return { automatedPass: failures.length === 0, lifecycleAndInteractionPass: failures.length === 0, failures, checks,
    semanticAcceptance: null, overallAcceptance: false, usefulConversationQualified: false,
    manualReview: { answerUsefulness: null, criteria: fixture.reviewCriteria.slice(0, 4), reviewer: null,
      // recipientApproval checks each authorization against the recorded permission screen (report.permissions).
      // Whether its wording reads as informed consent (REP-7 docs/roadmap/requirements.md:145) is a person's call.
      recipientDisclosureContract: null },
    redispatchScope: 'No changed attempt/history or running attempt during the recorded return interval; not proof about all future execution.' };
}

