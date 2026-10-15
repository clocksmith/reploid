/** Capacity-weighted readiness utilization over an interval, from exported records only.
 *
 * Maintained: time a contributor stage was prepared and offered (`ready` readiness spans) times the capacity it
 * admitted (attempt slots or admitted bytes, as the span declares). Consumed: each admission record's held slot
 * (reservedAt to settledAt) times its admitted amount, classified by the requester attempt's outcome. Useful: only
 * completed attempts a quality decision marked satisfactory. Paid: readiness inside an accepted readiness contract
 * for that exact stage. Time no span covers, undeclared capacity and undecided outcomes stay unknown, never zero,
 * and make the affected ratio null with its reasons. No prices: capacity-seconds only. */

export const CAPACITY_UTILIZATION_SCHEMA = 'reploid.capacity-utilization/v1';
export const READINESS_SPAN_SCHEMA = 'reploid.readiness-span/v1';
/** Capacity unit -> the admission record's `resources` field holding each admission's amount in that unit. */
export const CAPACITY_UNITS = Object.freeze({ 'attempt-slots': 'attemptSlots', bytes: 'attemptBytes' });
export const ADMISSION_OUTCOMES = Object.freeze(['satisfactory', 'unsatisfactory', 'unassessed', 'failed', 'cancelled',
  'interrupted', 'active', 'unmatched']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const ACTIVE = new Set(['queued', 'loading', 'executing', 'approval', 'cancelling']);
const SUPPLY_LABELS = ['local', 'mesh', 'hosted', 'mixed', 'none', 'unknown'];

const fail = message => { throw new Error(`Capacity utilization: ${message}`); };
const time = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' && value.length > 0;
const keyOf = (...parts) => JSON.stringify(parts);
const seconds = ms => ms / 1000;
const overlap = (a, b, from, to) => Math.max(0, Math.min(b, to) - Math.max(a, from));

function stageOf(input, where) {
  if (!text(input.participantId) || !text(input.modelIdentity) || !text(input.planId)
    || !Number.isSafeInteger(input.stageIndex) || input.stageIndex < 0) fail(`${where} needs participantId, modelIdentity, planId and stageIndex`);
  return { participantId: input.participantId, modelIdentity: input.modelIdentity, planId: input.planId, stageIndex: input.stageIndex };
}
const stageKey = stage => keyOf(stage.participantId, stage.modelIdentity, stage.planId, stage.stageIndex);

function readinessSpan(span) {
  const stage = stageOf(span, 'A readiness span');
  if (!time(span.from) || !time(span.to) || span.to <= span.from || !['ready', 'unready'].includes(span.state)) {
    fail('a readiness span needs from < to and state ready or unready');
  }
  const capacity = span.capacity ?? null;
  if (capacity !== null && (!Object.hasOwn(CAPACITY_UNITS, capacity.unit) || !time(capacity.amount) || capacity.amount < 0)) {
    fail('readiness capacity needs a known unit and a non-negative amount');
  }
  return { ...stage, from: span.from, to: span.to, state: span.state, capacity: capacity && { unit: capacity.unit, amount: capacity.amount } };
}

/** The admission's stage, attempt and route from its own reservation identity (ordered route or legacy pair). */
function admissionRecord(record) {
  const identity = record?.identity, route = identity?.route;
  if (!text(identity?.attemptId) || !text(record.participantId) || !Number.isSafeInteger(record.index)) {
    fail('an admission record needs identity.attemptId, participantId and index');
  }
  const stage = stageOf({ participantId: record.participantId, stageIndex: record.index,
    modelIdentity: route?.modelIdentity ?? identity.modelIdentity, planId: route?.planId ?? identity.planId }, 'An admission record');
  const participants = Array.isArray(route?.stages) ? route.stages.map(row => row?.participantId)
    : [identity.participantA, identity.participantB];
  if (!participants.every(text)) fail('an admission record needs its route participants');
  if (record.reservedAt !== null && !time(record.reservedAt) || record.settledAt != null && !time(record.settledAt)
    || record.observedUntil != null && !time(record.observedUntil) || record.releasedBy != null
      && (!time(record.releasedBy) || record.observedUntil == null || record.releasedBy < record.observedUntil)) {
    fail('admission times must be epoch milliseconds or null');
  }
  // An unsettled admission was observed held until observedUntil; after it, whether it was held is unknown until
  // releasedBy (its host session had ended by then), or indefinitely without one.
  return { ...stage, attemptId: identity.attemptId, reservedAt: record.reservedAt ?? null, settledAt: record.settledAt ?? null,
    observedUntil: record.observedUntil ?? null, releasedBy: record.releasedBy ?? null,
    failed: record.failure != null || record.phase === 'failed', resources: record.resources ?? null,
    route: { modelIdentity: stage.modelIdentity, planId: stage.planId, participants } };
}

/** Repeated exports of one admission merge to the most settled copy; contradictory copies are refused. */
function mergeAdmissions(records) {
  const rows = new Map();
  for (const row of records.map(admissionRecord)) {
    const key = keyOf(stageKey(row), row.attemptId), previous = rows.get(key);
    if (!previous) { rows.set(key, row); continue; }
    if (previous.reservedAt !== row.reservedAt || previous.settledAt !== null && row.settledAt !== null && previous.settledAt !== row.settledAt) {
      fail(`conflicting admission records for attempt ${row.attemptId}`);
    }
    // A copy without its own horizon was observed at export, which bounds it no earlier than any recorded copy.
    const latest = previous.observedUntil === null || row.observedUntil === null ? null
      : row.observedUntil > previous.observedUntil ? row : previous;
    rows.set(key, { ...previous, settledAt: previous.settledAt ?? row.settledAt, failed: previous.failed || row.failed,
      observedUntil: latest?.observedUntil ?? null, releasedBy: latest?.releasedBy ?? null });
  }
  return [...rows.values()];
}

function contractRecord(contract) {
  const stage = stageOf(contract, 'A readiness contract');
  if (!text(contract.offerId) || !time(contract.from) || !time(contract.to) || contract.to <= contract.from) {
    fail('a readiness contract needs offerId and from < to');
  }
  return { ...stage, offerId: contract.offerId, from: contract.from, to: contract.to, accepted: contract.status === 'accepted' };
}

/** Piecewise stage state over the interval: ready/unready/unknown, capacity, and whether a contract pays for it. */
function stageTimeline(spans, contracts, from, to) {
  const clamp = value => Math.min(to, Math.max(from, value));
  const points = [...new Set([from, to, ...spans.flatMap(row => [clamp(row.from), clamp(row.to)]),
    ...contracts.flatMap(row => [clamp(row.from), clamp(row.to)])])].sort((a, b) => a - b);
  const segments = [];
  let next = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i], b = points[i + 1];
    while (next < spans.length && spans[next].to <= a) next++;
    const span = next < spans.length && spans[next].from <= a ? spans[next] : null;
    segments.push({ from: a, to: b, state: span ? span.state : 'unknown',
      capacity: span?.state === 'ready' ? span.capacity?.amount ?? null : null,
      paid: contracts.some(row => row.from <= a && row.to >= b) });
  }
  return segments;
}
const segmentAt = (segments, at) => segments.find(row => row.from <= at && at < row.to);

function emptyMaintained() {
  return { capacitySeconds: null, knownCapacitySeconds: 0, paidCapacitySeconds: 0, unpaidCapacitySeconds: 0,
    readyMs: 0, unreadyMs: 0, unknownMs: 0, undeclaredCapacityMs: 0, paidUnknownMs: 0 };
}
/** Adds one piece of readiness: its state, total capacity (null when undeclared) and paid share of that capacity. */
function addReadiness(total, { state, capacity, paidCapacity, paidAny }, ms) {
  if (state === 'unknown') { total.unknownMs += ms; if (paidAny) total.paidUnknownMs += ms; return; }
  if (state === 'unready') { total.unreadyMs += ms; return; }
  total.readyMs += ms;
  if (capacity === null) { total.undeclaredCapacityMs += ms; if (paidAny) total.paidUnknownMs += ms; return; }
  total.knownCapacitySeconds += capacity * seconds(ms);
  total.paidCapacitySeconds += paidCapacity * seconds(ms);
  total.unpaidCapacitySeconds += (capacity - paidCapacity) * seconds(ms);
}
const closeMaintained = total => ({ ...total,
  capacitySeconds: total.unknownMs || total.undeclaredCapacityMs ? null : total.knownCapacitySeconds });

function emptyConsumed() {
  return { capacitySeconds: 0, admissions: 0, open: 0, unknownAmount: 0,
    byOutcome: Object.fromEntries(ADMISSION_OUTCOMES.map(name => [name, { admissions: 0, capacitySeconds: 0, paidCapacitySeconds: 0 }])) };
}
function addConsumed(total, row) {
  total.admissions++; if (row.open) total.open++;
  const bucket = total.byOutcome[row.outcome];
  bucket.admissions++;
  if (row.amount === null) { total.unknownAmount++; return; }
  total.capacitySeconds += row.capacitySeconds; bucket.capacitySeconds += row.capacitySeconds;
  bucket.paidCapacitySeconds += row.paidCapacitySeconds;
}

function outcomeOf(admission, attempt) {
  if (admission.failed) return 'failed';
  if (!attempt) return 'unmatched';
  if (attempt.status === 'completed') return attempt.satisfactory === true ? 'satisfactory' : attempt.satisfactory === false ? 'unsatisfactory' : 'unassessed';
  if (TERMINAL.has(attempt.status)) return attempt.status;
  return ACTIVE.has(attempt.status) ? 'active' : 'unmatched';
}

/** Ratios of useful and occupied capacity-seconds to maintained; null with reasons when any input is unknown. */
function ratios(maintained, consumed, incomplete) {
  const reasons = [];
  if (maintained.unknownMs) reasons.push('readiness-gaps');
  if (maintained.undeclaredCapacityMs) reasons.push('capacity-not-declared');
  if (consumed.unknownAmount) reasons.push('unknown-consumption-amount');
  if (incomplete) reasons.push('open-after-observation');
  const outcomes = consumed.byOutcome;
  if (outcomes.unassessed.admissions) reasons.push('unassessed-completions');
  if (outcomes.unmatched.admissions) reasons.push('unmatched-admissions');
  if (outcomes.active.admissions) reasons.push('active-attempts');
  const occupiedKnown = !maintained.unknownMs && !maintained.undeclaredCapacityMs && !consumed.unknownAmount && !incomplete;
  const usefulKnown = occupiedKnown && !outcomes.unassessed.admissions && !outcomes.unmatched.admissions && !outcomes.active.admissions;
  const divide = (value, by, known) => known && by > 0 ? value / by : null;
  return { reasons,
    usefulToMaintained: divide(outcomes.satisfactory.capacitySeconds, maintained.knownCapacitySeconds, usefulKnown),
    usefulToPaid: divide(outcomes.satisfactory.paidCapacitySeconds, maintained.paidCapacitySeconds, usefulKnown && !maintained.paidUnknownMs),
    occupiedToMaintained: divide(consumed.capacitySeconds, maintained.knownCapacitySeconds, occupiedKnown) };
}

const unitOf = spans => {
  const units = [...new Set(spans.filter(row => row.capacity).map(row => row.capacity.unit))];
  if (units.length > 1) fail(`one stage declares several capacity units: ${units.join(', ')}`);
  return units[0] ?? 'attempt-slots';
};

/**
 * @param {object} input
 * @param {{from:number,to:number}} input.interval epoch milliseconds
 * @param {number} [input.observedUntil] when the admission and attempt records were exported; defaults to interval.to
 * @param {object[]} [input.readiness] `reploid.readiness-span/v1` spans per contributor stage
 * @param {object[]} [input.admissions] contributor reservation records (resident `getState().reservations.records`)
 * @param {object[]} [input.attempts] requester outcomes `{ attemptId, status, satisfactory?, supply? }`
 * @param {object[]} [input.contracts] readiness contracts `{ offerId, participantId, modelIdentity, planId, stageIndex, from, to, status }`
 */
export function summarizeCapacityUtilization({ interval, observedUntil, readiness = [], admissions = [], attempts = [], contracts = [] } = {}) {
  if (!time(interval?.from) || !time(interval?.to) || interval.to <= interval.from) fail('interval needs from < to');
  const { from, to } = interval, until = observedUntil ?? to;
  if (!time(until)) fail('observedUntil must be epoch milliseconds');
  const outcomes = new Map();
  for (const row of attempts) {
    if (!text(row?.attemptId) || !text(row.status)) fail('an attempt outcome needs attemptId and status');
    const previous = outcomes.get(row.attemptId);
    if (previous && (previous.status !== row.status || (previous.satisfactory ?? null) !== (row.satisfactory ?? null))) {
      fail(`conflicting outcomes for attempt ${row.attemptId}`);
    }
    outcomes.set(row.attemptId, row);
  }
  const stages = new Map(), stage = record => {
    const key = stageKey(record);
    if (!stages.has(key)) stages.set(key, { stage: stageOf(record, 'A stage'), spans: [], contracts: [], admissions: [] });
    return stages.get(key);
  };
  for (const span of readiness.map(readinessSpan)) stage(span).spans.push(span);
  for (const contract of contracts.map(contractRecord)) if (contract.accepted) stage(contract).contracts.push(contract);
  const routes = new Map();
  for (const admission of mergeAdmissions(admissions)) {
    stage(admission).admissions.push(admission);
    const key = keyOf(admission.route.modelIdentity, admission.route.planId, ...admission.route.participants);
    if (!routes.has(key)) routes.set(key, { route: admission.route, admissions: [] });
    routes.get(key).admissions.push(admission);
  }
  const rows = new Map();
  for (const [key, entry] of stages) {
    entry.spans.sort((a, b) => a.from - b.from);
    entry.spans.forEach((row, index) => { if (index && entry.spans[index - 1].to > row.from) fail(`readiness spans overlap for ${key}`); });
    const unit = unitOf(entry.spans), segments = stageTimeline(entry.spans, entry.contracts, from, to);
    const maintained = emptyMaintained();
    for (const row of segments) addReadiness(maintained, { state: row.state, capacity: row.capacity,
      paidCapacity: row.paid ? row.capacity ?? 0 : 0, paidAny: row.paid }, row.to - row.from);
    const consumed = emptyConsumed();
    // An admission holds its slot from reservation until cleanup settles; one still open when the records were
    // exported (or at its own last observation, when earlier) is counted to that time, and the rest of the interval
    // is unknown until it is known released. Tombstones never held a slot.
    const measured = entry.admissions.flatMap(admission => {
      if (admission.reservedAt === null) return [];
      const open = admission.settledAt === null;
      const horizon = open && admission.observedUntil !== null ? Math.min(until, admission.observedUntil) : until;
      const released = open ? admission.releasedBy ?? Infinity : admission.settledAt;
      const end = open ? Math.min(to, horizon) : admission.settledAt;
      if (admission.reservedAt >= to || released <= from) return [];
      const field = CAPACITY_UNITS[unit], amount = time(admission.resources?.[field]) ? admission.resources[field] : null;
      const heldMs = overlap(admission.reservedAt, end, from, to);
      const paidMs = segments.filter(row => row.paid).reduce((sum, row) => sum + overlap(admission.reservedAt, end, row.from, row.to), 0);
      return [{ admission, outcome: outcomeOf(admission, outcomes.get(admission.attemptId)), amount, open,
        incomplete: open && Math.max(from, horizon) < Math.min(to, released),
        capacitySeconds: amount === null ? null : amount * seconds(heldMs), paidCapacitySeconds: amount === null ? null : amount * seconds(paidMs) }];
    });
    for (const row of measured) addConsumed(consumed, row);
    const incomplete = measured.some(row => row.incomplete);
    const closed = closeMaintained(maintained);
    rows.set(key, { stage: entry.stage, unit, segments, measured, incomplete,
      summary: { ...entry.stage, unit, contracts: entry.contracts.map(row => row.offerId), maintained: closed, consumed,
        ratios: ratios(closed, consumed, incomplete) } });
  }
  const aggregate = list => {
    const units = [...new Set(list.map(row => row.unit))];
    const maintained = emptyMaintained(), consumed = emptyConsumed();
    for (const row of list) {
      for (const name of Object.keys(maintained)) if (name !== 'capacitySeconds') maintained[name] += row.summary.maintained[name];
      for (const name of ['capacitySeconds', 'admissions', 'open', 'unknownAmount']) consumed[name] += row.summary.consumed[name];
      for (const name of ADMISSION_OUTCOMES) for (const field of ['admissions', 'capacitySeconds', 'paidCapacitySeconds']) {
        consumed.byOutcome[name][field] += row.summary.consumed.byOutcome[name][field];
      }
    }
    const closed = closeMaintained(maintained);
    return units.length > 1 ? { unit: null, reason: 'mixed-units' }
      : { unit: units[0] ?? 'attempt-slots', maintained: closed, consumed, ratios: ratios(closed, consumed, list.some(row => row.incomplete)) };
  };
  const contributors = [...new Set([...rows.values()].map(row => row.stage.participantId))].sort().map(participantId => {
    const list = [...rows.values()].filter(row => row.stage.participantId === participantId);
    return { participantId, stages: list.map(row => row.summary), total: aggregate(list) };
  });
  return { schema: CAPACITY_UTILIZATION_SCHEMA, interval: { from, to, durationMs: to - from }, observedUntil: until,
    contributors, routes: [...routes.values()].map(entry => routeSummary(entry, rows, from, to)),
    attempts: attemptSupply(outcomes) };
}

/** A route is ready while every stage is ready; its capacity is the sum of its stages', in their shared unit. */
function routeSummary({ route, admissions }, rows, from, to) {
  const stages = route.participants.map((participantId, stageIndex) => rows.get(stageKey({ participantId, stageIndex,
    modelIdentity: route.modelIdentity, planId: route.planId })));
  const units = [...new Set(stages.map(row => row?.unit ?? 'attempt-slots'))];
  const base = { route: structuredClone(route) };
  if (units.length > 1) return { ...base, unit: null, reason: 'mixed-units' };
  const points = [...new Set([from, to, ...stages.flatMap(row => row ? row.segments.flatMap(segment => [segment.from, segment.to]) : [])])]
    .sort((a, b) => a - b);
  const maintained = emptyMaintained();
  for (let i = 0; i + 1 < points.length; i++) {
    const parts = stages.map(row => row && segmentAt(row.segments, points[i]));
    const state = parts.some(part => !part || part.state === 'unknown') ? 'unknown' : parts.every(part => part.state === 'ready') ? 'ready' : 'unready';
    const capacity = state !== 'ready' || parts.some(part => part.capacity === null) ? null : parts.reduce((sum, part) => sum + part.capacity, 0);
    const paidCapacity = capacity === null ? 0 : parts.reduce((sum, part) => sum + (part.paid ? part.capacity : 0), 0);
    addReadiness(maintained, { state, capacity, paidCapacity, paidAny: parts.some(part => part?.paid) }, points[i + 1] - points[i]);
  }
  const consumed = emptyConsumed(), ids = new Set(admissions.map(row => row.attemptId));
  let incomplete = false;
  for (const row of stages) for (const entry of row?.measured ?? []) {
    if (!ids.has(entry.admission.attemptId)) continue;
    addConsumed(consumed, entry); incomplete ||= entry.incomplete;
  }
  const closed = closeMaintained(maintained);
  return { ...base, unit: units[0], maintained: closed, consumed, ratios: ratios(closed, consumed, incomplete) };
}

function attemptSupply(outcomes) {
  const bySupply = Object.fromEntries([...SUPPLY_LABELS, 'unclassified'].map(name => [name, 0]));
  const byStatus = {};
  for (const row of outcomes.values()) {
    bySupply[SUPPLY_LABELS.includes(row.supply) ? row.supply : 'unclassified']++;
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  }
  return { total: outcomes.size, bySupply, byStatus };
}

/** Requester outcomes from an exported `reploid.chat-workspace/v1`, with each attempt's recorded answer supply. */
export function attemptOutcomesFromWorkspace(workspace) {
  if (workspace?.schema !== 'reploid.chat-workspace/v1' || !Array.isArray(workspace.threads)) fail('expected a reploid.chat-workspace/v1 export');
  return workspace.threads.flatMap(thread => thread.attempts.map(attempt => ({ attemptId: attempt.id, status: attempt.status,
    supply: attempt.provenance?.schema === 'reploid.answer-provenance/v1' ? attempt.provenance.supply : null })));
}

/** Readiness contracts from `reploid.contribution-offer/v1` prepared-readiness offers; only accepted ones pay. */
export function readinessContractsFromOffers(offers) {
  return offers.filter(offer => offer?.schema === 'reploid.contribution-offer/v1' && offer.category === 'prepared_readiness')
    .map(offer => ({ offerId: offer.offerId, participantId: offer.work?.participantId, modelIdentity: offer.work?.stage?.model?.modelIdentity,
      planId: offer.work?.stage?.model?.planId, stageIndex: offer.work?.stage?.stageIndex,
      from: Date.parse(offer.duration?.startsAt), to: Date.parse(offer.duration?.endsAt), status: offer.status ?? null }));
}
