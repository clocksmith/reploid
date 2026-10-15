/** Retrieval for one request: provider search, optional passage extraction, bounded numbered context
 * and the provenance record kept with the conversation. Providers and extractors are host ports. */
import defaults from './policy.json' with { type: 'json' };
import { SHA256, sha256Text } from './text.js';
import { COST_BEARERS, retrievalCostEntry, retrievalCostRecord, unknownRetrievalCosts } from './costs.js';

export const RETRIEVAL_RECORD_SCHEMA = 'reploid.retrieval-record/v1';
export const RETRIEVAL_OUTCOMES = Object.freeze(['pending', 'retrieved', 'empty', 'failed', 'cancelled', 'interrupted']);
const LIMIT_NAMES = ['maxResults', 'maxSourceCharacters', 'maxContextCharacters', 'timeoutMs'];
const FAILURES = Object.freeze({
  'no-results': 'the search returned no results',
  timeout: 'retrieval exceeded its time limit',
  'provider-error': 'the search provider failed',
  'invalid-provider-result': 'the search provider returned an invalid result',
  'extraction-failed': 'no source text could be extracted',
  'context-limit': 'no source fits the context limit',
  cancelled: 'the request was stopped during retrieval',
  interrupted: 'the connection was interrupted during retrieval'
});

class RetrievalError extends Error {
  constructor(code, detail = null) { super(FAILURES[code]); this.code = code; this.detail = detail; }
}
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const copy = value => structuredClone(value);
const port = value => value && typeof value.id === 'string' && value.id && typeof value.version === 'string' && value.version;
const line = value => String(value).replace(/\s+/g, ' ').trim();

export function validateRetrievalPolicy(policy) {
  assert(policy && typeof policy.id === 'string' && typeof policy.version === 'string'
    && LIMIT_NAMES.every(name => Number.isSafeInteger(policy.maxima?.[name]) && policy.maxima[name] > 0
      && Number.isSafeInteger(policy.defaults?.[name]) && policy.defaults[name] > 0 && policy.defaults[name] <= policy.maxima[name])
    && policy.maxima.timeoutMs <= 2147483647 && Number.isSafeInteger(policy.maxQueryCharacters) && policy.maxQueryCharacters > 0
    && Number.isSafeInteger(policy.maxSupportChecks) && policy.maxSupportChecks >= 0
    && ['schema', 'instructions', 'sourcesHeading', 'questionLabel'].every(name => typeof policy.context?.[name] === 'string'),
  'Invalid retrieval policy');
  return copy(policy);
}

/** Requested limits may only narrow the policy maxima; omitted limits use the policy defaults. */
export function normalizeRetrievalLimits(requested = {}, policy = defaults) {
  assert(requested && typeof requested === 'object' && !Array.isArray(requested)
    && Object.keys(requested).every(name => LIMIT_NAMES.includes(name)), 'Unknown retrieval limit');
  return Object.fromEntries(LIMIT_NAMES.map(name => {
    const value = requested[name] ?? policy.defaults[name];
    assert(Number.isSafeInteger(value) && value > 0 && value <= policy.maxima[name], `Retrieval ${name} is outside the policy limit`);
    return [name, value];
  }));
}

/** The request's opt-in: the query sent to the provider and its limits. Defaults to the message text. */
export function normalizeRetrievalRequest(input, content, policy = defaults) {
  assert(input && typeof input === 'object' && !Array.isArray(input)
    && Object.keys(input).every(name => ['query', 'limits'].includes(name)), 'Invalid retrieval request');
  assert(input.query === undefined || typeof input.query === 'string', 'Invalid search query');
  const query = (input.query ?? content).trim();
  assert(query, 'Search query is empty');
  assert(query.length <= policy.maxQueryCharacters, 'Search query exceeds the retrieval limit');
  return { query, limits: normalizeRetrievalLimits(input.limits, policy) };
}

export function pendingRetrievalRecord({ request, provider, extractor = null, policy = defaults, startedAt }) {
  return { schema: RETRIEVAL_RECORD_SCHEMA, policy: { id: policy.id, version: policy.version },
    provider: { id: provider.id, version: provider.version },
    extractor: extractor ? { id: extractor.id, version: extractor.version } : null,
    // Every source below came from the provider this request explicitly opted into.
    sourceUse: 'requester-opt-in', query: request.query, limits: copy(request.limits),
    outcome: 'pending', error: null, startedAt, finishedAt: null, providerResultCount: null,
    sources: [], omitted: [], context: null, usage: null, verification: null, costs: null };
}

export function retrievalFailureMessage(record) {
  return `Could not retrieve sources: ${FAILURES[record?.error?.code] || 'retrieval did not complete'}.`;
}

/** Marks a record left pending by a reload. Nothing it would have retrieved was sent; what it spent was not observed. */
export function interruptRetrievalRecord(record, finishedAt) {
  if (record?.outcome !== 'pending') return record;
  return { ...record, outcome: 'interrupted', error: { code: 'interrupted', message: FAILURES.interrupted }, finishedAt,
    costs: retrievalCostRecord({ retrieval: unknownRetrievalCosts() }) };
}

const webUrl = value => {
  try { return typeof value === 'string' && value.length <= 2048 && ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
};
function validResult(value) {
  return value && typeof value === 'object' && typeof value.sourceId === 'string' && /^[\x21-\x7e]{1,256}$/.test(value.sourceId)
    && webUrl(value.url) && typeof value.title === 'string' && line(value.title) && value.title.length <= 1000
    && typeof value.excerpt === 'string' && value.excerpt.trim()
    && Number.isFinite(value.retrievedAt) && value.retrievedAt > 0 && typeof value.contentHash === 'string' && SHA256.test(value.contentHash);
}
const count = value => Number.isSafeInteger(value) && value >= 0;
/** Where a fetched passage sits in the extracted document text the extractor hashed. */
const validDocument = (value, text) => value === undefined || value && typeof value === 'object' && webUrl(value.url)
  && typeof value.contentType === 'string' && value.contentType.length <= 200 && SHA256.test(value.sha256)
  && count(value.start) && count(value.end) && value.end - value.start === text.length && count(value.characters)
  && value.end <= value.characters && (value.bytes === undefined || count(value.bytes))
  && (value.status === undefined || Number.isSafeInteger(value.status) && value.status >= 200 && value.status < 300);
const validPassage = (value, source) => value && typeof value === 'object' && value.sourceId === source.sourceId
  && (value.title === undefined || typeof value.title === 'string' && value.title.length <= 1000)
  && typeof value.text === 'string' && value.text.trim() && Number.isFinite(value.retrievedAt) && value.retrievedAt > 0
  && typeof value.contentHash === 'string' && SHA256.test(value.contentHash) && validDocument(value.document, value.text)
  && (value.costMicroUsd === undefined || value.costMicroUsd === null || count(value.costMicroUsd));
/** Provider-reported usage for one query: billable requests and, when priced, the cost in micro-dollars. */
const validUsage = value => value === undefined || value && typeof value === 'object' && typeof value.provider === 'string'
  && /^[\x21-\x7e]{1,64}$/.test(value.provider) && count(value.requests) && (value.costMicroUsd === null || count(value.costMicroUsd));
/** Providers return results, or `{ results, usage }` when they report per-query usage. */
const providerResults = value => Array.isArray(value) ? { results: value, usage: undefined }
  : value && typeof value === 'object' && Array.isArray(value.results) ? { results: value.results, usage: value.usage } : null;

/** The retained passage's offsets in the extracted document: the extractor's span, less trimmed and truncated text. */
function retainedDocument(document, text, retained) {
  if (!document) return null;
  const start = document.start + (text.length - text.trimStart().length);
  return { url: document.url, contentType: document.contentType, characters: document.characters, sha256: document.sha256,
    start, end: start + retained.length, ...(document.bytes === undefined ? {} : { bytes: document.bytes }),
    ...(document.status === undefined ? {} : { status: document.status }) };
}

/** Passages longer than the per-source limit are cut at a word boundary when one is near. */
function bounded(text, limit) {
  const clean = text.trim();
  if (clean.length <= limit) return { text: clean, truncated: false };
  const cut = clean.slice(0, limit), space = cut.search(/\s\S*$/);
  return { text: (space > limit * 0.8 ? cut.slice(0, space) : cut).trimEnd(), truncated: true };
}

const sourceBlock = source => `[${source.number}] ${source.title}\n${source.url}\n${source.passage}`;
/** The exact numbered context sent with the question. Deterministic for a record's sources and policy. */
export function renderSourceContext(sources, policy = defaults) {
  return `${policy.context.instructions}\n\n${policy.context.sourcesHeading}\n\n${sources.map(sourceBlock).join('\n\n')}`;
}

/** Waits for `operation` unless the deadline passes or the attempt stops; providers that ignore their signal cannot extend it. */
function race(operation, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const stop = () => reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    Promise.resolve().then(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

/** Runs one retrieval and returns the finished record. Failures are recorded, never thrown and never filled with sources.
 * `answer` is an opaque key for the answer this retrieval serves; providers may pass it to their own usage log so
 * service economics can sum costs per answer. It is never part of the query. */
export async function retrieveSources({ record, provider, extractor = null, signal, now = Date.now, policy = defaults, answer = null }) {
  const limits = record.limits, deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new RetrievalError('timeout')), limits.timeoutMs);
  const forward = () => deadline.abort(new RetrievalError('cancelled'));
  if (signal?.aborted) forward(); else signal?.addEventListener('abort', forward, { once: true });
  let usage = null;
  // What this retrieval spent, for its cost record: observed even when it fails.
  const meter = { searched: false, usage: null, attempted: 0, documents: 0, failed: 0, bytes: 0, costs: [] };
  const context = answer === null ? {} : { answer };
  const finish = (fields) => ({ ...record, ...fields, usage, finishedAt: now(), costs: retrievalCostRecord({
    retrieval: retrievalCostEntry({ bearer: provider.costBearer ?? null, service: provider.searchProvider ?? null, meter }) }) });
  try {
    let returned;
    try {
      returned = providerResults(await race(() => { meter.searched = true; return provider.search(record.query, copy(limits), deadline.signal, copy(context)); },
        deadline.signal));
    } catch (error) { throw error instanceof RetrievalError ? error : new RetrievalError('provider-error', error); }
    if (!returned || !returned.results.every(validResult) || !validUsage(returned.usage)) throw new RetrievalError('invalid-provider-result');
    const results = returned.results;
    // Recorded before anything else can fail: a failed or empty search may still have been billed.
    const searchUsage = returned.usage ? { provider: returned.usage.provider, requests: returned.usage.requests,
      costMicroUsd: returned.usage.costMicroUsd } : null;
    meter.usage = searchUsage;
    usage = { search: searchUsage, extraction: { documents: 0, bytes: 0 } };
    if (!results.length) return finish({ outcome: 'empty', error: { code: 'no-results', message: FAILURES['no-results'] }, providerResultCount: 0 });
    const omitted = [], seen = new Set(), kept = [];
    for (const result of results) {
      if (seen.has(result.sourceId)) continue;
      seen.add(result.sourceId);
      if (kept.length < limits.maxResults) kept.push(result); else omitted.push({ sourceId: result.sourceId, reason: 'result-limit' });
    }
    if (extractor) meter.attempted = kept.length;
    const passages = await Promise.allSettled(kept.map(source => extractor
      ? race(() => extractor.extract({ source: copy(source), query: record.query, limits: copy(limits), signal: deadline.signal, ...copy(context) }),
        deadline.signal)
        .then(value => { if (!validPassage(value, source)) throw new Error('Invalid extracted passage'); return { ...value, origin: 'extract' }; })
      : Promise.resolve({ sourceId: source.sourceId, text: source.excerpt, retrievedAt: source.retrievedAt,
        contentHash: source.contentHash, origin: 'search-excerpt' })));
    if (extractor) for (const passage of passages) {
      if (passage.status === 'rejected') { meter.failed++; continue; }
      const bytes = passage.value.document?.bytes;
      meter.documents++;
      meter.bytes = meter.bytes === null || bytes === undefined ? null : meter.bytes + bytes;
      meter.costs.push(passage.value.costMicroUsd ?? null);
    }
    if (deadline.signal.aborted) throw deadline.signal.reason;
    const candidates = [];
    kept.forEach((source, index) => {
      const passage = passages[index];
      if (passage.status === 'rejected') { omitted.push({ sourceId: source.sourceId, reason: 'extraction-failed' }); return; }
      const { text, truncated } = bounded(passage.value.text, limits.maxSourceCharacters);
      const document = retainedDocument(passage.value.document, passage.value.text, text);
      if (document) { usage.extraction.documents++; usage.extraction.bytes += document.bytes ?? 0; }
      // A fetched page supplies its own address and title, so retained and forwarded sources keep nothing from the
      // search response beyond transient use: search terms (such as Brave's) forbid storing or redistributing results.
      const page = passage.value.document;
      candidates.push({ sourceId: source.sourceId, url: page ? page.url : source.url,
        title: page ? line(passage.value.title ?? '') || page.url : line(source.title), retrievedAt: passage.value.retrievedAt,
        contentHash: passage.value.contentHash, passage: text, passageOrigin: passage.value.origin, truncated,
        ...(document ? { document } : {}) });
    });
    if (!candidates.length) throw new RetrievalError('extraction-failed');
    // Sources are numbered in provider order; any that would push the context past its limit are omitted.
    const sources = [];
    for (const candidate of candidates) {
      const next = [...sources, { number: sources.length + 1, ...candidate }];
      if (renderSourceContext(next, policy).length <= limits.maxContextCharacters) sources.push(next.at(-1));
      else omitted.push({ sourceId: candidate.sourceId, reason: 'context-limit' });
    }
    if (!sources.length) throw new RetrievalError('context-limit');
    for (const source of sources) source.passageHash = await sha256Text(source.passage);
    const content = renderSourceContext(sources, policy);
    return finish({ outcome: 'retrieved', providerResultCount: results.length, sources, omitted,
      context: { schema: policy.context.schema, characters: content.length, digest: await sha256Text(content) } });
  } catch (cause) {
    const error = cause instanceof RetrievalError ? cause : new RetrievalError('provider-error', cause);
    return finish({ outcome: error.code === 'cancelled' ? 'cancelled' : 'failed', sources: [], context: null,
      error: { code: error.code, message: FAILURES[error.code] } });
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', forward);
  }
}

/** The request executors receive: the latest user turn carries the numbered sources, checked against the record's digest. */
export async function withSourceContext(request, record, policy = defaults) {
  assert(record?.outcome === 'retrieved' && record.sources.length, retrievalFailureMessage(record));
  const content = renderSourceContext(record.sources, policy);
  assert(record.context?.schema === policy.context.schema && await sha256Text(content) === record.context.digest,
    'Retrieved context does not match its recorded digest');
  const { retrieval, ...executed } = request, messages = request.messages.map(message => ({ ...message }));
  const last = messages.at(-1);
  assert(last?.role === 'user', 'Retrieval requires a user question');
  last.content = `${content}\n\n${policy.context.questionLabel} ${last.content}`;
  return { ...executed, messages };
}

export function validateRetrievalPorts({ provider, extractor = null, supportChecker = null }) {
  assert(port(provider) && typeof provider.search === 'function', 'Retrieval requires a search provider');
  assert(provider.costBearer === undefined || COST_BEARERS.includes(provider.costBearer), 'Invalid search provider cost bearer');
  assert(extractor === null || port(extractor) && typeof extractor.extract === 'function', 'Invalid passage extractor');
  assert(supportChecker === null || port(supportChecker) && typeof supportChecker.check === 'function', 'Invalid citation support checker');
}
