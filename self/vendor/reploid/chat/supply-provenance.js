/** Answer-level supply provenance: which class of supply executed an answer, derived only from the attempt's
 * execution and route records, never from text. `local` is this device, `mesh` is community contributors
 * (a peer's whole request or partition stages), `hosted` is a hosted/API service, and `mixed` is more than one
 * class within one answer: a route whose stages differ, or explicit retries that ran on different classes.
 * `none` means no executor was engaged; `unknown` means a record exists that names no recognized Doppler
 * executor, or output exists without any executor record. Unknown is never counted as mesh. Retrieval supply
 * (an operator's server route or a search from this device) is recorded separately from execution supply. */

export const ANSWER_PROVENANCE_SCHEMA = 'reploid.answer-provenance/v1';
export const SUPPLY_CLASSES = Object.freeze(['local', 'mesh', 'hosted']);
export const HOSTED_EXECUTION_REFUSED = 'This answer came from a hosted service, which needs separate authorization. It was not accepted.';
export const UNRECOGNIZED_EXECUTION_REFUSED = 'This answer came from an executor Reploid does not recognize. It was not accepted.';

const ORDER = new Map(SUPPLY_CLASSES.map((name, index) => [name, index]));
const RETRIEVAL_SUPPLY = new Set(['server', 'device']);
const EXECUTOR_FIELDS = ['provider', 'placement', 'identity', 'peerId', 'participantA', 'participantB', 'hostedProvider'];
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const unknown = (placement, reason) => ({ supply: 'unknown', classes: [], placement: typeof placement === 'string' ? placement : null,
  participants: [], reason });

/** One or more classes as one label: none, a single class, or mixed. */
export function supplyOf(classes) {
  const set = [...new Set(classes)].sort((a, b) => ORDER.get(a) - ORDER.get(b));
  return { supply: set.length === 0 ? 'none' : set.length === 1 ? set[0] : 'mixed', classes: set };
}

function participantsSupply(placement, participants) {
  return { ...supplyOf(participants.map(row => row.supply)), placement, participants };
}

/**
 * Classify one execution record. `localIds` are the identities of this device (history owner and authenticated
 * requester); a route record's own requester binding also marks its local stage. Recognized records are the Doppler
 * paths the conversation host produces, plus the hosted record `{ provider: 'hosted', placement: 'hosted-api',
 * hostedProvider }`. Anything else, including a record that contradicts itself, is `unknown`.
 */
export function classifyExecutionSupply(execution, { localIds = [] } = {}) {
  if (execution === null || execution === undefined) return { supply: 'none', classes: [], placement: null, participants: [] };
  if (typeof execution !== 'object' || Array.isArray(execution)) return unknown(null, 'invalid-record');
  // A record naming no executor (timing or stop data only) reports nothing about supply.
  if (!EXECUTOR_FIELDS.some(field => execution[field] !== undefined)) return unknown(null, 'executor-not-reported');
  const { provider, placement } = execution;
  if (provider === 'hosted') {
    return placement === 'hosted-api' && id(execution.hostedProvider)
      ? participantsSupply('hosted-api', [{ participantId: null, provider: execution.hostedProvider, supply: 'hosted', role: 'whole-request', stage: null }])
      : unknown(placement, 'incomplete-hosted-record');
  }
  if (placement === 'hosted-api') return unknown(placement, 'incomplete-hosted-record');
  if (![undefined, 'doppler', 'peer'].includes(provider)) return unknown(placement, 'unrecognized-provider');
  const local = new Set(localIds.filter(id));
  const stage = (participantId, index, requesterId) => ({ participantId, supply: local.has(participantId) || participantId === requesterId ? 'local' : 'mesh',
    role: 'stage', stage: index });
  const identity = execution.identity, route = identity?.schema === 'reploid.partition-attempt/v2' ? identity.route : undefined;
  if (route !== undefined || placement === 'ordered-layer-partition') {
    if (![undefined, 'ordered-layer-partition'].includes(placement) || route?.schema !== 'reploid.partition-route/v1'
      || !Array.isArray(route.stages) || !route.stages.length || !route.stages.every(row => id(row?.participantId))) {
      return unknown(placement, 'invalid-route-record');
    }
    return participantsSupply('ordered-layer-partition',
      route.stages.map((row, index) => stage(row.participantId, index, identity.requesterId)));
  }
  if (placement === 'local-webgpu') {
    return provider === 'doppler' ? participantsSupply(placement, [{ participantId: [...local][0] ?? null, supply: 'local', role: 'whole-request', stage: null }])
      : unknown(placement, 'unrecognized-provider');
  }
  if (placement === 'peer-whole-request') {
    if (provider !== 'peer' || !id(execution.peerId)) return unknown(placement, 'incomplete-peer-record');
    return participantsSupply(placement, [{ participantId: execution.peerId, supply: local.has(execution.peerId) ? 'local' : 'mesh',
      role: 'whole-request', stage: null }]);
  }
  if (placement === 'two-device-layer-partition') {
    if (!id(execution.participantA) || !id(execution.participantB)) return unknown(placement, 'incomplete-partition-record');
    return participantsSupply(placement, [execution.participantA, execution.participantB]
      .map((participantId, index) => stage(participantId, index, execution.requesterId)));
  }
  return unknown(placement, 'unrecognized-placement');
}

/** Whether a conversation may accept output from this execution: hosted service has no authorization path in the
 * conversation product, and a record naming an executor Reploid does not recognize is refused. A record naming no
 * executor is not refused here; it stays unknown and is never counted as mesh. Returns the refusal, or null. */
export function executionRefusal(classified) {
  if (classified.supply === 'hosted' || classified.classes.includes('hosted')) return HOSTED_EXECUTION_REFUSED;
  return classified.supply === 'unknown' && classified.reason !== 'executor-not-reported' ? UNRECOGNIZED_EXECUTION_REFUSED : null;
}

/** Where retrieval for this attempt ran, from its retrieval record's declared provider supply. */
export function retrievalSupply(attempt) {
  if (!attempt?.request?.retrieval) return { supply: 'none' };
  const record = attempt.retrieval, declared = record?.provider?.supply;
  return { supply: RETRIEVAL_SUPPLY.has(declared) ? declared : 'unknown', route: attempt.request.retrieval.route ?? null,
    provider: id(record?.provider?.id) ? record.provider.id : null,
    searchService: attempt.searchPermission?.searchProvider ?? null, searchServer: attempt.searchPermission?.searchServer ?? null,
    outcome: typeof record?.outcome === 'string' ? record.outcome : null };
}

/** This attempt's own execution supply. Output with no executor record is unknown, never none. */
export function attemptExecutionSupply(attempt, { localIds = [], produced = false } = {}) {
  const classified = classifyExecutionSupply(attempt.execution ?? null, { localIds });
  return classified.supply === 'none' && (attempt.status === 'completed' || produced)
    ? unknown(null, 'executor-not-reported') : classified;
}

/**
 * The provenance record for a terminal attempt: its own execution supply, its retry lineage (earlier attempts of
 * the same answer, oldest first, through `retryOf`) and the answer-level supply over both. An unknown part makes
 * the answer unknown. `thread` supplies the lineage and the attempt's response text.
 */
export function answerProvenance(thread, attempt, { localIds = [] } = {}) {
  const content = thread.messages?.find(message => message.id === attempt.responseId)?.content;
  const execution = attemptExecutionSupply(attempt, { localIds, produced: typeof content === 'string' && content.length > 0 });
  const earlier = [], seen = new Set([attempt.id]);
  for (let previous = attempt.retryOf; previous && !seen.has(previous);) {
    seen.add(previous);
    const row = thread.attempts.find(item => item.id === previous);
    if (!row) { earlier.unshift({ attemptId: previous, status: null, supply: 'unknown', classes: [] }); break; }
    const own = row.provenance?.schema === ANSWER_PROVENANCE_SCHEMA ? row.provenance.execution
      : attemptExecutionSupply(row, { localIds, produced: !!thread.messages?.find(message => message.id === row.responseId)?.content });
    earlier.unshift({ attemptId: row.id, status: row.status, supply: own.supply, classes: [...own.classes] });
    previous = row.retryOf;
  }
  const parts = [execution, ...earlier];
  const answer = parts.some(part => part.supply === 'unknown') ? { supply: 'unknown', classes: [] }
    : supplyOf(parts.flatMap(part => part.classes));
  return structuredClone({ schema: ANSWER_PROVENANCE_SCHEMA, attemptId: attempt.id, supply: answer.supply, classes: answer.classes,
    execution, earlierAttempts: earlier, retrieval: retrievalSupply(attempt) });
}
