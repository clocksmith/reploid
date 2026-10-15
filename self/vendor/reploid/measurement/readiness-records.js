/** Readiness spans and stage admissions as a contributor host records them, and the summary inputs read back from them.
 *
 * A host gives the recorder each automatic-partitions state it observes (`observe`) and each resident it prepares
 * (`watchResident`). A stage is `ready` while the host offers it, its phase is `ready`, Doppler reports the resident
 * ready and it holds or admits at least one attempt slot; its capacity is those slots (`active + availableSlots`, after
 * any owner gate). Every other observed state of a stage this session has seen is `unready`, and a stage first seen
 * at time t was unready on this host from the session start to t. A span is written when it opens, at each checkpoint
 * and when it closes; every copy is complete, so a bounded store may keep only the latest. Admissions are written when
 * reserved, at checkpoints while held and when settled.
 *
 * Records carry identities, times and slot counts only: never conversation text, thread or requester identities, or
 * error text. Unknown stays unknown: before a session first sees a stage, after an open span's last observation (a
 * crashed host, or one still running when its records were exported), and over an observation gap longer than
 * `maxObservationGapMs` while ready (a suspended machine is not serving) no span covers the time. */
import { READINESS_SPAN_SCHEMA, CAPACITY_UNITS } from './capacity-utilization.js';

export const STAGE_ADMISSION_SCHEMA = 'reploid.stage-admission/v1';
export const UTILIZATION_INPUT_SCHEMA = 'reploid.capacity-utilization-input/v1';
export const READINESS_CHECKPOINT_MS = 60_000;
export const READINESS_MAX_OBSERVATION_GAP_MS = 60_000;
export const READINESS_STORE_MAX_RECORDS = 500;
export const READINESS_HOSTS = Object.freeze(['node', 'browser']);

const fail = message => { throw new Error(`Readiness records: ${message}`); };
const time = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' && value.length > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => Number.isSafeInteger(value) && value > 0;
const keyOf = (...parts) => JSON.stringify(parts);
const stageKey = stage => keyOf(stage.participantId, stage.modelIdentity, stage.planId, stage.stageIndex);

/** The stage an automatic-partitions state holds, whether it is offered ready, and the slots it holds or admits. */
function observedStage(state, participantId) {
  const descriptor = state?.descriptor;
  if (!descriptor || !text(descriptor.modelIdentity) || !text(descriptor.planId) || !count(descriptor.index)) return null;
  const reservations = state.reservations;
  const amount = reservations && reservations.closed !== true && count(reservations.active) && count(reservations.availableSlots)
    ? reservations.active + reservations.availableSlots : 0;
  const ready = state.offering === true && state.phase === 'ready' && descriptor.ready === true && amount > 0;
  return { key: null, ready, capacity: ready ? { unit: 'attempt-slots', amount } : null,
    stage: { participantId, modelIdentity: descriptor.modelIdentity, planId: descriptor.planId, stageIndex: descriptor.index } };
}

/** Why a ready span ended, from the state that ended it. */
function readyEnd(state, key, current) {
  if (current?.ready && current.key === key) return 'capacity-changed';
  if (state?.phase === 'failed') return 'failed';
  if (state?.offering !== true) return 'stopped';
  if (current?.key === key) return 'not-admitting';
  return current ? 'stage-changed' : 'unprepared';
}

/** The fields the summary reads from a resident reservation record; tombstones never held a slot. */
function admissionOf(resident, record) {
  const identity = record?.identity, route = identity?.route;
  if (!time(record?.reservedAt) || !text(identity?.attemptId)) return null;
  const participantId = record.participantId ?? resident.participantId, index = record.index ?? resident.index;
  if (!text(participantId) || !count(index)) return null;
  const amounts = record.resources && Object.fromEntries(['attemptSlots', 'attemptBytes']
    .filter(name => count(record.resources[name])).map(name => [name, record.resources[name]]));
  return { participantId, index, phase: text(record.phase) ? record.phase : null,
    reservedAt: record.reservedAt, settlingAt: time(record.settlingAt) ? record.settlingAt : null,
    settledAt: time(record.settledAt) ? record.settledAt : null, failure: record.failure == null ? null : 'failed',
    identity: route ? { attemptId: identity.attemptId, route: { modelIdentity: route.modelIdentity, planId: route.planId,
      stages: (Array.isArray(route.stages) ? route.stages : []).map(row => ({ index: row?.index, participantId: row?.participantId })) } }
      : { attemptId: identity.attemptId, modelIdentity: identity.modelIdentity, planId: identity.planId,
        participantA: identity.participantA, participantB: identity.participantB },
    resources: amounts && Object.keys(amounts).length ? amounts : null };
}

/**
 * @param {object} options
 * @param {string} options.participantId this host's participant identity (the one its residents admit as)
 * @param {'node'|'browser'} options.host
 * @param {(record: object) => void} options.write sink for each record copy; it owns persistence and its own failures
 */
export function createReadinessRecorder({ participantId, host, write, now = Date.now, sessionId = crypto.randomUUID(),
  checkpointMs = READINESS_CHECKPOINT_MS, maxObservationGapMs = READINESS_MAX_OBSERVATION_GAP_MS }) {
  if (!text(participantId) || !READINESS_HOSTS.includes(host) || typeof write !== 'function' || typeof now !== 'function'
    || !text(sessionId) || !positive(checkpointMs) || !positive(maxObservationGapMs)) {
    fail('a recorder needs participantId, host node or browser, a write sink and positive checkpoint and gap bounds');
  }
  let latest = now();
  const startedAt = latest;
  let observedAt = startedAt, checkpointAt = startedAt, ended = false, closed = false, failures = 0;
  const stages = new Map(), residents = new Set();
  // Times never run backwards within a session, so its own spans cannot overlap.
  const clock = () => { const value = now(); if (time(value) && value > latest) latest = value; return latest; };
  const emit = record => { try { write(record); } catch { failures++; } };
  const session = { sessionId, sessionStartedAt: startedAt, host };
  const spanCopy = (span, observed, to = null, end = null) => ({ schema: READINESS_SPAN_SCHEMA, spanId: span.spanId, ...session,
    ...span.stage, state: span.state, capacity: span.capacity && { ...span.capacity }, from: span.from, to, observedAt: observed, end });
  const admissionCopy = (record, observed) => ({ schema: STAGE_ADMISSION_SCHEMA, ...session, observedAt: observed, ...structuredClone(record) });
  function open(entry, state, capacity, from, at) {
    entry.span = { spanId: crypto.randomUUID(), stage: entry.stage, state, capacity, from };
    emit(spanCopy(entry.span, at));
  }
  function close(entry, to, end) {
    if (!entry.span) return;
    emit(spanCopy(entry.span, to, to, end)); entry.span = null;
  }
  // Time since the last observation is unobserved: a ready claim cannot cover it. Unready stays unready.
  function closeGap(at) {
    if (at - observedAt <= maxObservationGapMs) return;
    for (const entry of stages.values()) if (entry.span?.state === 'ready') close(entry, observedAt, 'observation-gap');
  }
  function checkpoint(at) {
    checkpointAt = at;
    for (const entry of stages.values()) if (entry.span) emit(spanCopy(entry.span, at));
    for (const watch of residents) for (const record of watch.held()) emit(admissionCopy(record, at));
  }
  const guarded = fn => (...args) => { try { return fn(...args); } catch { failures++; } };
  const observe = guarded(state => {
    if (ended) return;
    const at = clock();
    closeGap(at);
    const current = observedStage(state, participantId);
    if (current) {
      current.key = stageKey(current.stage);
      if (!stages.has(current.key)) {
        const entry = { stage: current.stage, span: null };
        stages.set(current.key, entry);
        // This session observed every state since it started: the stage was not ready here before now.
        if (startedAt < at) open(entry, 'unready', null, startedAt, at);
      }
    }
    for (const [key, entry] of stages) {
      const ready = !!current?.ready && current.key === key, capacity = ready ? current.capacity : null;
      if (entry.span && entry.span.state === (ready ? 'ready' : 'unready') && entry.span.capacity?.amount === capacity?.amount) continue;
      if (entry.span) close(entry, at, entry.span.state === 'ready' ? readyEnd(state, key, current) : 'ready');
      open(entry, ready ? 'ready' : 'unready', capacity, at, at);
    }
    observedAt = at;
    if (at - checkpointAt >= checkpointMs) checkpoint(at);
  });
  /** Records this resident's admissions from its own state until it closes; the resident is borrowed, never closed. */
  const watchResident = guarded(resident => {
    if (closed || typeof resident?.subscribe !== 'function') return;
    const written = new Map();
    let held = [], done = false, unsubscribe = null;
    const watch = { held: () => held, stop() { done = true; residents.delete(watch); unsubscribe?.(); } };
    residents.add(watch);
    const listener = guarded(state => {
      if (done || closed) return;
      const at = clock(), records = Array.isArray(state?.reservations?.records) ? state.reservations.records : [];
      const rows = records.map(record => admissionOf(state, record)).filter(Boolean);
      held = rows.filter(row => row.settledAt === null);
      for (const row of rows) {
        const settled = row.settledAt !== null, previous = written.get(row.identity.attemptId);
        if (previous === true || previous === false && !settled) continue;
        written.set(row.identity.attemptId, settled); emit(admissionCopy(row, at));
      }
      if (state?.phase === 'closed') watch.stop();
    });
    unsubscribe = resident.subscribe(listener);
    if (done) unsubscribe?.();
  });
  /** Stops readiness: every open span closes now with `reason`. Admissions keep recording until `close`. */
  const end = guarded((reason = 'closed') => {
    if (ended) return;
    const at = clock();
    closeGap(at);
    for (const entry of stages.values()) close(entry, at, reason);
    ended = true;
  });
  return Object.freeze({ sessionId, observe, watchResident, end,
    /** Ends readiness, writes each still-held admission's last observation and stops watching residents. */
    close: guarded((reason = 'closed') => {
      end(reason);
      if (closed) return;
      const at = clock();
      for (const watch of [...residents]) { for (const record of watch.held()) emit(admissionCopy(record, at)); watch.stop(); }
      closed = true;
    }),
    getState: () => ({ sessionId, host, participantId, startedAt, observedAt, ended, closed, failures,
      stages: stages.size, open: [...stages.values()].filter(entry => entry.span).length, residents: residents.size })
  });
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const sessionOf = record => text(record.sessionId) && time(record.sessionStartedAt) && READINESS_HOSTS.includes(record.host);

function spanRecord(record) {
  const capacity = record.capacity ?? null;
  if (!text(record.spanId) || !sessionOf(record) || !text(record.participantId) || !text(record.modelIdentity)
    || !text(record.planId) || !count(record.stageIndex) || !['ready', 'unready'].includes(record.state) || !time(record.from)
    || !time(record.observedAt) || record.observedAt < record.from || record.to != null && (!time(record.to) || record.to < record.from)
    || capacity !== null && (record.state !== 'ready' || !Object.hasOwn(CAPACITY_UNITS, capacity.unit) || !time(capacity.amount) || capacity.amount < 0)) {
    fail(`malformed readiness span ${String(record.spanId)}`);
  }
  return record;
}

function admissionRecord(record) {
  if (!sessionOf(record) || !text(record.participantId) || !count(record.index) || !text(record.identity?.attemptId)
    || !time(record.reservedAt) || !time(record.observedAt) || record.settledAt != null && !time(record.settledAt)) {
    fail(`malformed stage admission ${String(record.identity?.attemptId)}`);
  }
  return record;
}

/**
 * Spans and admissions for summarizeCapacityUtilization from recorded copies. A closed span keeps its recorded end; an
 * open span counts only through its last observed copy and is listed in `unterminated`. An admission never seen settled
 * carries `observedUntil` (its last observation), after which the summary treats it as unknown; its resident cannot
 * outlive its session, so the next session of the same participant and host kind to start after that observation
 * bounds it as `releasedBy`. Conflicting copies are refused.
 */
export function readinessInputFromRecords(records) {
  if (!Array.isArray(records)) fail('expected an array of records');
  const spans = new Map(), admissions = new Map(), sessions = new Map();
  for (const record of records) {
    if (record?.schema === READINESS_SPAN_SCHEMA || record?.schema === STAGE_ADMISSION_SCHEMA) {
      if (!sessionOf(record)) fail(`record without its session: ${String(record.spanId ?? record.identity?.attemptId)}`);
      const session = [record.participantId, record.host, record.sessionStartedAt], known = sessions.get(record.sessionId);
      if (known && !sameJson(known, session)) fail(`conflicting session ${record.sessionId}`);
      sessions.set(record.sessionId, session);
    }
    if (record?.schema === READINESS_SPAN_SCHEMA) {
      const row = spanRecord(record), entry = spans.get(row.spanId);
      const fixed = [row.sessionId, row.participantId, row.modelIdentity, row.planId, row.stageIndex, row.state, row.capacity ?? null, row.from];
      if (!entry) { spans.set(row.spanId, { fixed, to: row.to ?? null, end: row.end ?? null, observedAt: row.observedAt, row }); continue; }
      if (!sameJson(entry.fixed, fixed) || entry.to !== null && row.to != null && entry.to !== row.to) fail(`conflicting copies of span ${row.spanId}`);
      entry.to ??= row.to ?? null; entry.end ??= row.end ?? null; entry.observedAt = Math.max(entry.observedAt, row.observedAt);
    } else if (record?.schema === STAGE_ADMISSION_SCHEMA) {
      const row = admissionRecord(record), key = keyOf(row.sessionId, row.participantId, row.index, row.identity.attemptId);
      const entry = admissions.get(key);
      if (!entry) { admissions.set(key, { row, observedAt: row.observedAt }); continue; }
      if (entry.row.reservedAt !== row.reservedAt || entry.row.settledAt != null && row.settledAt != null && entry.row.settledAt !== row.settledAt) {
        fail(`conflicting copies of admission ${row.identity.attemptId}`);
      }
      if (entry.row.settledAt == null && (row.settledAt != null || row.observedAt >= entry.row.observedAt)) entry.row = row;
      entry.observedAt = Math.max(entry.observedAt, row.observedAt);
    } else fail(`unknown record schema ${String(record?.schema)}`);
  }
  const readiness = [], unterminated = [];
  let zeroLength = 0;
  for (const [spanId, { to, end, observedAt, row }] of spans) {
    const until = to ?? observedAt;
    if (to === null) unterminated.push({ spanId, sessionId: row.sessionId, participantId: row.participantId, modelIdentity: row.modelIdentity,
      planId: row.planId, stageIndex: row.stageIndex, state: row.state, from: row.from, lastObservedAt: observedAt });
    if (until > row.from) readiness.push({ schema: READINESS_SPAN_SCHEMA, participantId: row.participantId, modelIdentity: row.modelIdentity,
      planId: row.planId, stageIndex: row.stageIndex, state: row.state, capacity: row.capacity ?? null, from: row.from, to: until,
      ...(end ? { end } : {}) });
    else if (to !== null) zeroLength++;
  }
  const releasedBy = (row, observedAt) => {
    const starts = [...sessions].filter(([id, [participantId, host, startedAt]]) => id !== row.sessionId
      && participantId === row.participantId && host === row.host && startedAt >= observedAt).map(([, session]) => session[2]);
    return starts.length ? Math.min(...starts) : null;
  };
  return { readiness, unterminated, zeroLength,
    admissions: [...admissions.values()].map(({ row, observedAt }) => {
      const { schema: _schema, sessionId: _session, sessionStartedAt: _started, host: _host, observedAt: _observed, ...admission } = row;
      return row.settledAt == null ? { ...admission, observedUntil: observedAt, releasedBy: releasedBy(row, observedAt) } : admission;
    }) };
}

/**
 * A bounded store over a `getItem`/`setItem` storage port whose stored value is itself a
 * `reploid.capacity-utilization-input/v1` document (`readinessRecords[]`, `readinessDropped`), readable by the CLI.
 * Only the latest copy of each span or admission is kept; past `maxRecords` the oldest observed are dropped and counted.
 * Storage failures keep the batch for the next write; nothing is thrown to the host.
 */
export function createReadinessRecordStore({ storage, key, maxRecords = READINESS_STORE_MAX_RECORDS }) {
  if (typeof storage?.getItem !== 'function' || typeof storage.setItem !== 'function' || !text(key) || !positive(maxRecords)) {
    fail('a record store needs a storage port, a key and a positive record bound');
  }
  let pending = [], scheduled = false, failures = 0;
  const identityOf = record => record.schema === READINESS_SPAN_SCHEMA ? keyOf('span', record.spanId)
    : keyOf('admission', record.sessionId, record.participantId, record.index, record.identity?.attemptId);
  const final = record => record.schema === READINESS_SPAN_SCHEMA ? record.to != null : record.settledAt != null;
  const supersedes = (next, previous) => final(next) !== final(previous) ? final(next) : !final(previous) && next.observedAt >= previous.observedAt;
  function read() {
    try {
      const doc = JSON.parse(storage.getItem(key) ?? 'null');
      if (doc?.schema === UTILIZATION_INPUT_SCHEMA && Array.isArray(doc.readinessRecords)) {
        return { schema: UTILIZATION_INPUT_SCHEMA, readinessRecords: doc.readinessRecords, readinessDropped: count(doc.readinessDropped) ? doc.readinessDropped : 0 };
      }
    } catch { /* An unreadable stored value starts a new document. */ }
    return { schema: UTILIZATION_INPUT_SCHEMA, readinessRecords: [], readinessDropped: 0 };
  }
  function merged() {
    const doc = read(), rows = new Map(doc.readinessRecords.map(record => [identityOf(record), record]));
    for (const record of pending) {
      const id = identityOf(record), previous = rows.get(id);
      if (!previous || supersedes(record, previous)) rows.set(id, record);
    }
    const list = [...rows.values()].sort((a, b) => a.observedAt - b.observedAt), dropped = Math.max(0, list.length - maxRecords);
    return { schema: UTILIZATION_INPUT_SCHEMA, readinessRecords: list.slice(dropped), readinessDropped: doc.readinessDropped + dropped };
  }
  function flush() {
    scheduled = false;
    if (!pending.length) return;
    const doc = merged();
    try { storage.setItem(key, JSON.stringify(doc)); pending = []; }
    catch { failures++; pending = pending.slice(-maxRecords); }
  }
  return Object.freeze({
    write(record) {
      pending.push(structuredClone(record));
      if (!scheduled) { scheduled = true; queueMicrotask(flush); }
    },
    flush,
    /** The stored document with any unwritten records merged in; the CLI reads it as an input file. */
    export() { flush(); return structuredClone(pending.length ? merged() : read()); },
    getState: () => ({ pending: pending.length, failures })
  });
}
