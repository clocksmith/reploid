/** Mechanical citation checks for one answer against its retrieval record. Parsing and mapping are exact;
 * whether a source supports a claim is delegated to a host support checker and is never inferred here. */
export const CITATION_VERIFICATION_SCHEMA = 'reploid.citation-verification/v1';
export const SUPPORT_VERDICTS = Object.freeze(['supported', 'unsupported', 'unverified']);

const MARKER = /\[(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)\]/g;
const MARKERS_ONLY = /^(?:\s*\[(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)\])+\s*[.,;:!?]?\s*$/;
// A sentence ends at terminal punctuation followed by space or line end; markers after the period stay with it.
const SENTENCE = /\S[^]*?(?:[.!?]+["'’”)\]]*(?:\s*\[\d{1,3}(?:\s*[,–-]\s*\d{1,3})*\])*(?=\s|$)|$)/g;
const URL_TEXT = /\bhttps?:\/\/[^\s<>"'`\]\[)(]+/g;
// "Sources:", "**References**" and similar labels open a source list; "Sources disagree" does not.
const SOURCE_LABEL = /^\s*(?:\*\*|__)?(?:sources|references|citations)(?:\*\*|__)?\s*(?::(?:\*\*|__)?|$)/i;
const MAX_RANGE = 20;

function markerNumbers(group) {
  return group.split(',').flatMap(part => {
    const [from, to] = part.split(/[–-]/).map(value => Number(value.trim()));
    if (to === undefined) return [from];
    return to >= from && to - from <= MAX_RANGE ? Array.from({ length: to - from + 1 }, (_, index) => from + index) : [from, to];
  });
}
const markersIn = text => [...new Set([...text.matchAll(MARKER)].flatMap(match => markerNumbers(match[1])))];
const withoutMarkers = text => text.replace(MARKER, '').replace(/\s+([.,;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
const trimUrl = url => url.replace(/[.,;:!?]+$/, '');
const sameUrl = (a, b) => a === b || a.replace(/\/$/, '') === b.replace(/\/$/, '');

/**
 * Splits an answer into claims (sentences outside code, headings and a trailing source list) with their
 * citation markers, reference-list entries, and every URL the answer names.
 */
export function parseCitations(answer) {
  const claims = [], references = [], urls = [];
  let offset = 0, fenced = false, referenceList = false;
  for (const raw of String(answer).split('\n')) {
    const start = offset; offset += raw.length + 1;
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    for (const match of raw.matchAll(URL_TEXT)) urls.push({ url: trimUrl(match[0]), start: start + match.index });
    if (!raw.trim()) continue;
    if (/^\s{0,3}#{1,6}\s/.test(raw)) { referenceList = /^\s{0,3}#{1,6}\s+(sources|references|citations)\b/i.test(raw); continue; }
    const listed = raw.match(/^(\s*(?:[-*+•]|\d{1,3}[.)])\s+)/)?.[1] || '';
    const body = raw.slice(listed.length), opensWithMarker = /^\s*\[\d{1,3}\]/.test(body);
    // A "Sources:" line starts a source list that continues through list items and marker-led lines.
    // A marker-led line naming a URL is a reference entry anywhere.
    const label = !listed && SOURCE_LABEL.test(raw);
    if (label) referenceList = true;
    else if (referenceList && !(listed || opensWithMarker)) referenceList = false;
    if (referenceList || opensWithMarker && /\bhttps?:\/\//.test(body)) {
      const text = (label ? raw.replace(SOURCE_LABEL, '') : body).trim();
      if (text) references.push({ start, end: start + raw.length, markers: markersIn(text), text });
      continue;
    }
    for (const match of body.matchAll(SENTENCE)) {
      const sentence = match[0].trimEnd(), text = withoutMarkers(sentence);
      const at = start + listed.length + match.index;
      if (MARKERS_ONLY.test(sentence) && claims.length) {
        // A marker group separated from its sentence belongs to the preceding claim.
        const previous = claims.at(-1);
        previous.markers = [...new Set([...previous.markers, ...markersIn(sentence)])]; previous.end = at + sentence.length;
        continue;
      }
      if (!/[\p{L}\p{N}]/u.test(text)) continue;
      const markers = markersIn(sentence);
      if (!markers.length && /:\s*$/.test(text)) continue; // A lead-in such as "The sources say:" asserts nothing.
      claims.push({ index: claims.length, start: at, end: at + sentence.length, text, markers });
    }
  }
  return { claims, references, urls };
}

const unverified = reason => ({ verdict: 'unverified', reason });
const STOPPED = 'Support checking stopped before this citation.';
/** A checker that ignores its signal cannot hold the attempt past it. */
function untilStopped(operation, signal) {
  if (!signal) return Promise.resolve().then(operation);
  return new Promise((resolve, reject) => {
    const stop = () => resolve(unverified(STOPPED));
    signal.addEventListener('abort', stop, { once: true });
    Promise.resolve().then(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}
function judged(value) {
  if (!value || !SUPPORT_VERDICTS.includes(value.verdict) || typeof value.reason !== 'string' || !value.reason.trim()) {
    return unverified('The support checker returned an invalid result.');
  }
  return { verdict: value.verdict, reason: value.reason.trim().slice(0, 500) };
}

/**
 * Maps every citation marker to the record's numbered sources, flags uncited claims, unresolved markers and URLs
 * absent from the record, and asks the support checker about each resolved citation. Without a checker, or past
 * the check limit, support is unverified. Nothing here grades the answer; flags are evidence for review.
 */
export async function verifyCitations({ answer, record, checker = null, signal = null, maxSupportChecks = 256 }) {
  const parsed = parseCitations(answer), byNumber = new Map((record?.sources || []).map(source => [source.number, source]));
  const known = (record?.sources || []).map(source => source.url);
  let checks = 0;
  const support = async (claim, source) => {
    if (!checker) return unverified('No support checker is configured.');
    if (signal?.aborted) return unverified(STOPPED);
    if (checks >= maxSupportChecks) return unverified('The support check limit was reached.');
    checks++;
    try {
      return judged(await untilStopped(() => checker.check({ claim, signal, source: { number: source.number,
        sourceId: source.sourceId, title: source.title, url: source.url, passage: source.passage } }), signal));
    } catch (error) { return unverified(`The support checker failed: ${String(error?.message || error).slice(0, 200)}`); }
  };
  const claims = [], flags = [];
  for (const claim of parsed.claims) {
    const citations = [];
    for (const marker of claim.markers) {
      const source = byNumber.get(marker);
      if (!source) { citations.push({ marker, sourceId: null, resolved: false, support: null }); continue; }
      citations.push({ marker, sourceId: source.sourceId, resolved: true, support: await support(claim.text, source) });
    }
    claims.push({ ...claim, cited: citations.length > 0, citations });
    if (!citations.length) flags.push({ kind: 'uncited-claim', claim: claim.index });
    for (const citation of citations) {
      if (!citation.resolved) flags.push({ kind: 'unresolved-citation', claim: claim.index, marker: citation.marker });
      else if (citation.support.verdict === 'unsupported') flags.push({ kind: 'unsupported-citation', claim: claim.index,
        marker: citation.marker, reason: citation.support.reason });
      else if (citation.support.verdict === 'unverified') flags.push({ kind: 'unverified-support', claim: claim.index, marker: citation.marker });
    }
  }
  const references = parsed.references.map(entry => ({ ...entry, unresolved: entry.markers.filter(marker => !byNumber.has(marker)) }));
  for (const entry of references) {
    for (const marker of entry.unresolved) flags.push({ kind: 'unresolved-reference', marker });
    // "[2] https://..." must name source 2's own URL, not another retrieved source's.
    const source = entry.markers.length === 1 ? byNumber.get(entry.markers[0]) : null;
    for (const match of source ? entry.text.matchAll(URL_TEXT) : []) {
      if (!sameUrl(source.url, trimUrl(match[0]))) flags.push({ kind: 'mismatched-reference', marker: source.number, url: trimUrl(match[0]) });
    }
  }
  const unrecordedUrls = [...new Set(parsed.urls.map(item => item.url).filter(url => !known.some(source => sameUrl(source, url))))];
  for (const url of unrecordedUrls) flags.push({ kind: 'unrecorded-url', url });
  const all = claims.flatMap(claim => claim.citations), verdict = name => all.filter(item => item.support?.verdict === name).length;
  return {
    schema: CITATION_VERIFICATION_SCHEMA,
    checker: checker ? { id: checker.id, version: checker.version } : null,
    claims, references, unrecordedUrls, flags,
    summary: { claims: claims.length, citedClaims: claims.filter(claim => claim.cited).length,
      uncitedClaims: claims.filter(claim => !claim.cited).length, citations: all.length,
      unresolvedCitations: all.filter(item => !item.resolved).length, supported: verdict('supported'),
      unsupported: verdict('unsupported'), unverified: verdict('unverified'), unrecordedUrls: unrecordedUrls.length }
  };
}
