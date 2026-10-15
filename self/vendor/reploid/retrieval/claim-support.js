/** Claim-to-span mapping and deterministic citation validity for one answer against its retrieval record.
 * Everything here is mechanical: a valid citation names a fetched source whose retained passage still hashes to
 * its record and contains the mapped span. Whether a span supports its claim is never decided here; only an
 * independent reviewer (support-review.js) decides that, so every reviewable claim stays unverified until then. */
import defaults from './policy.json' with { type: 'json' };
import { parseCitations } from './citations.js';
import { renderSourceContext } from './sources.js';
import { SHA256, contentWords, sha256Text } from './text.js';

export const CLAIM_SUPPORT_SCHEMA = 'reploid.claim-support/v1';
export const SPAN_ALIGNMENT = 'reploid.lexical-span-alignment/v1';
/** Why a citation is not deterministically valid. */
export const CITATION_PROBLEMS = Object.freeze(['unresolved-marker', 'mismatched-reference', 'not-retrieved', 'passage-hash-mismatch',
  'document-offsets-invalid', 'context-digest-mismatch', 'span-invalid']);

const URL_TEXT = /\bhttps?:\/\/[^\s<>"'`\]\[)(]+/g;
const trimUrl = url => url.replace(/[.,;:!?]+$/, '');
const sameUrl = (a, b) => a === b || a.replace(/\/$/, '') === b.replace(/\/$/, '');
const webUrl = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };

/** Sentence spans of a passage, as [start, end) offsets without surrounding whitespace. */
export function passageSentences(passage) {
  const spans = [];
  // A period ends a sentence only before whitespace or the end (after any closing quote), so 3.5 stays inside.
  for (const match of String(passage).matchAll(/(?:[^\n.!?]|[.!?](?!["'’”)\]]*(?:\s|$)))*(?:[.!?]+["'’”)\]]*|\n|$)/g)) {
    const raw = match[0], lead = raw.length - raw.trimStart().length, text = raw.trim();
    if (text && /[\p{L}\p{N}]/u.test(text)) spans.push({ start: match.index + lead, end: match.index + lead + text.length });
    if (!raw) break;
  }
  return spans;
}

/** The passage sentence sharing the most content words with the claim (earliest on ties); the whole passage when none does.
 * This only points the reviewer at evidence; overlap is not support. */
export function alignClaimSpan(claim, passage) {
  const words = new Set(contentWords(claim));
  let best = null;
  for (const span of passageSentences(passage)) {
    const score = contentWords(passage.slice(span.start, span.end)).filter(word => words.has(word)).length;
    if (score > (best?.score ?? 0)) best = { ...span, score };
  }
  return best ? { start: best.start, end: best.end, alignment: 'sentence' } : { start: 0, end: passage.length, alignment: 'whole-passage' };
}

/** A span is valid when it lies inside the passage, its text is exactly that slice and its hash is the slice's sha256. */
export async function validSpan(passage, span) {
  return !!span && Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end) && span.start >= 0 && span.end > span.start
    && span.end <= passage.length && span.text === passage.slice(span.start, span.end)
    && SHA256.test(span.sha256) && span.sha256 === await sha256Text(span.text);
}

/** Integrity of one retrieved source, independent of any claim. */
async function sourceProblems(record, source) {
  const problems = [];
  // The cited URL was fetched and extracted, not merely named by a search result.
  if (record.outcome !== 'retrieved' || source.passageOrigin !== 'extract' || !webUrl(source.url)
    || source.document && !webUrl(source.document.url)) problems.push('not-retrieved');
  if (await sha256Text(source.passage) !== source.passageHash) problems.push('passage-hash-mismatch');
  if (source.document && !(Number.isSafeInteger(source.document.start) && source.document.end - source.document.start === source.passage.length
    && source.document.end <= source.document.characters)) problems.push('document-offsets-invalid');
  return problems;
}

/**
 * Maps every claim of `answer` to spans of the passages it cites and checks each citation deterministically:
 * the marker resolves to a numbered source, any reference entry names that source's URL, the source was fetched,
 * its passage still matches its hash and offsets, the numbered context still matches the digest that was sent, and
 * the span is an exact, hashed slice of the passage. Uncited claims and claims citing only unknown markers are
 * unsupported; claims with a valid citation await independent review; claims whose citations all fail integrity
 * checks are unverified.
 */
export async function mapClaimSpans({ answer, record, policy = defaults }) {
  const parsed = parseCitations(answer), sources = record?.sources || [];
  const byNumber = new Map(sources.map(source => [source.number, source]));
  const contextValid = !!record?.context && sources.length > 0
    && await sha256Text(renderSourceContext(sources, policy)) === record.context.digest;
  const integrity = new Map();
  for (const source of sources) integrity.set(source.number, [...await sourceProblems(record, source), ...(contextValid ? [] : ['context-digest-mismatch'])]);
  // "[2] https://..." in a source list must name source 2's own URL.
  const mismatched = new Set();
  for (const entry of parsed.references) {
    const source = entry.markers.length === 1 ? byNumber.get(entry.markers[0]) : null;
    for (const match of source ? entry.text.matchAll(URL_TEXT) : []) if (!sameUrl(source.url, trimUrl(match[0]))) mismatched.add(source.number);
  }
  const claims = [];
  for (const claim of parsed.claims) {
    const citations = [];
    for (const marker of claim.markers) {
      const source = byNumber.get(marker);
      if (!source) { citations.push({ marker, sourceId: null, url: null, valid: false, problems: ['unresolved-marker'], span: null }); continue; }
      const aligned = alignClaimSpan(claim.text, source.passage), text = source.passage.slice(aligned.start, aligned.end);
      const span = { start: aligned.start, end: aligned.end, text, sha256: await sha256Text(text), alignment: aligned.alignment };
      const problems = [...integrity.get(marker), ...(mismatched.has(marker) ? ['mismatched-reference'] : []),
        ...(await validSpan(source.passage, span) ? [] : ['span-invalid'])];
      citations.push({ marker, sourceId: source.sourceId, url: source.url, passageHash: source.passageHash,
        ...(source.document ? { document: { sha256: source.document.sha256, start: source.document.start + span.start,
          end: source.document.start + span.end } } : {}), valid: !problems.length, problems, span });
    }
    const valid = citations.filter(citation => citation.valid);
    const [verdict, reason] = !citations.length ? ['unsupported', 'uncited']
      : citations.every(citation => citation.problems.includes('unresolved-marker')) ? ['unsupported', 'unresolved-citation']
        : valid.length ? ['unverified', 'awaiting-review'] : ['unverified', 'invalid-evidence'];
    claims.push({ id: `claim-${claim.index + 1}`, index: claim.index, text: claim.text, start: claim.start, end: claim.end,
      markers: claim.markers, citations, reviewable: valid.length > 0, verdict, reason });
  }
  const all = claims.flatMap(claim => claim.citations), tally = name => claims.filter(claim => claim.verdict === name).length;
  return { schema: CLAIM_SUPPORT_SCHEMA, alignment: SPAN_ALIGNMENT, query: record?.query ?? null,
    contextDigest: record?.context?.digest ?? null, contextValid, claims,
    summary: { claims: claims.length, citedClaims: claims.filter(claim => claim.citations.length).length,
      reviewableClaims: claims.filter(claim => claim.reviewable).length, citations: all.length,
      validCitations: all.filter(citation => citation.valid).length, invalidCitations: all.filter(citation => !citation.valid).length,
      supported: tally('supported'), unsupported: tally('unsupported'), unverified: tally('unverified') } };
}
