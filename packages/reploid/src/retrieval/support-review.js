/** Entailment review of mapped claims. A reviewer receives a blinded packet (question, answer, retained passages,
 * claims and their cited spans; no generator, model, adapter, route or contributor identity) and returns judgments.
 * The generating model can never certify its own claims: every judgment file is checked against the generator
 * identity, which the caller keeps outside the packet. Deterministic validity (claim-support.js) is applied first;
 * a reviewer can only decide claims that have at least one valid citation. */
import { SHA256, sha256Text } from './text.js';
import { validSpan } from './claim-support.js';

export const SUPPORT_REVIEW_PACKET_SCHEMA = 'reploid.claim-support-review-packet/v1';
export const SUPPORT_JUDGMENTS_SCHEMA = 'reploid.claim-support-judgments/v1';
export const SUPPORT_RESULT_SCHEMA = 'reploid.claim-support-result/v1';
export const REVIEW_VERDICTS = Object.freeze(['supported', 'unsupported', 'unverified']);
export const SUPPORT_REVIEW_INSTRUCTIONS = Object.freeze([
  'Judge each claim only against the recorded passages of the sources it cites. Do not use other knowledge to support it.',
  'supported: a cited passage states the claim or directly entails it. Name the span you relied on by source number and character offsets in that passage.',
  'unsupported: no cited passage states or entails the claim, or a cited passage contradicts it. A passage on the same topic that does not state the claim does not support it.',
  'unverified: you cannot decide from the recorded passages. Say what was missing.',
  'The suggested span is a lexical pointer, not evidence of support; you may cite another span of the same cited passage.',
  'Give a basis of one or two sentences for every judgment.'
]);

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
/** JSON with sorted keys, so a packet's hash does not depend on how it was serialized. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const supportPacketHash = packet => sha256Text(canonicalJson(packet));

/**
 * The blinded packet for the claims of one answer that have a valid citation. `claimSupport` comes from
 * mapClaimSpans over the same answer and record. Only cited sources' passages are included.
 */
export function createSupportReviewPacket({ id, question, answer, record, claimSupport }) {
  assert(text(id, 200) && /^[\x21-\x7e]+$/.test(id), 'Review packet id required');
  assert(typeof question === 'string' && typeof answer === 'string', 'Review packet needs the question and the answer');
  assert(claimSupport?.schema === 'reploid.claim-support/v1' && Array.isArray(record?.sources), 'Review packet needs the claim mapping and its record');
  const claims = claimSupport.claims.filter(claim => claim.reviewable).map(claim => ({ id: claim.id, text: claim.text,
    quote: { start: claim.start, end: claim.end }, citations: claim.citations.filter(citation => citation.valid)
      .map(citation => ({ source: citation.marker, suggestedSpan: { start: citation.span.start, end: citation.span.end,
        text: citation.span.text, sha256: citation.span.sha256 } })) }));
  const cited = new Set(claims.flatMap(claim => claim.citations.map(citation => citation.source)));
  return { schema: SUPPORT_REVIEW_PACKET_SCHEMA, id, instructions: [...SUPPORT_REVIEW_INSTRUCTIONS], question, answer,
    sources: record.sources.filter(source => cited.has(source.number)).map(source => ({ number: source.number, title: source.title,
      url: source.url, retrievedAt: source.retrievedAt, passage: source.passage, passageSha256: source.passageHash })),
    claims };
}

const normalizedName = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** The model that wrote the answer: its catalog id and content identity, from the attempt, never from the packet. */
export function validateGenerator(generator) {
  assert(generator && text(generator.modelId, 256) && SHA256.test(generator.modelIdentity), 'The generating model identity is required');
  return { modelId: generator.modelId, modelIdentity: generator.modelIdentity };
}
/** A reviewer may judge only when it is not the generating model, by name or content identity. */
export function assertIndependentReviewer(reviewer, generator) {
  const made = validateGenerator(generator);
  assert(reviewer && ['human', 'model'].includes(reviewer.kind) && text(reviewer.id, 256), 'Reviewer identity is required');
  const names = [reviewer.id, reviewer.model?.name].filter(Boolean).map(normalizedName);
  assert(!names.includes(normalizedName(made.modelId)) && reviewer.model?.identity !== made.modelIdentity && reviewer.id !== made.modelIdentity,
    'The generating model cannot certify its own claims');
  if (reviewer.kind === 'model') assert(text(reviewer.model?.name, 256) && text(reviewer.model?.provider, 256), 'A model reviewer names its model and provider');
}

/** Validates a judgment file against its packet and the generator; returns the per-claim judgments it makes. */
export async function validateSupportJudgments({ packet, judgments, generator }) {
  assert(judgments?.schema === SUPPORT_JUDGMENTS_SCHEMA, 'Invalid support judgments');
  assert(judgments.packet?.id === packet.id && judgments.packet?.sha256 === await supportPacketHash(packet),
    'Judgments do not belong to this review packet');
  assertIndependentReviewer(judgments.reviewer, generator);
  assert(Array.isArray(judgments.judgments), 'Invalid support judgments');
  const claims = new Map(packet.claims.map(claim => [claim.id, claim])), passages = new Map(packet.sources.map(source => [source.number, source.passage]));
  const seen = new Set(), decided = new Map();
  for (const item of judgments.judgments) {
    assert(item && claims.has(item.claim) && !seen.has(item.claim) && REVIEW_VERDICTS.includes(item.verdict) && text(item.basis, 2000),
      'Each judgment names one packet claim once, a verdict and a basis');
    seen.add(item.claim);
    const claim = claims.get(item.claim), cited = new Set(claim.citations.map(citation => citation.source));
    const spans = [];
    for (const span of Array.isArray(item.spans) ? item.spans : []) {
      const passage = passages.get(span?.source);
      if (!cited.has(span?.source) || passage === undefined) continue;
      // A span is given by offsets, or by an exact quote located at its first occurrence in the passage.
      const start = typeof span.quote === 'string' && span.quote ? passage.indexOf(span.quote) : span.start;
      const end = typeof span.quote === 'string' && span.quote ? start + span.quote.length : span.end;
      if (!(Number.isSafeInteger(start) && start >= 0 && Number.isSafeInteger(end))) continue;
      const slice = { start, end, text: passage.slice(start, end) };
      slice.sha256 = await sha256Text(slice.text);
      if (await validSpan(passage, slice)) spans.push({ source: span.source, ...slice });
    }
    // Support must rest on an exact span of a cited, recorded passage; otherwise it is not established.
    const judged = item.verdict === 'supported' && !spans.length
      ? { verdict: 'unverified', basis: `Marked supported without a valid span of a cited passage. Reviewer basis: ${item.basis.trim()}` }
      : { verdict: item.verdict, basis: item.basis.trim() };
    decided.set(item.claim, { ...judged, spans });
  }
  return decided;
}

/**
 * Per-claim outcome for one answer: deterministic results for claims no reviewer can decide, and for reviewable
 * claims the reviewers' verdicts. When reviewers disagree, a third review decides: a verdict held by a strict majority
 * of at least three reviews settles the claim, and every review stays in the result. Without such a majority the claim
 * stays disputed and unverified. A claim no reviewer judged stays unverified.
 */
export async function applySupportJudgments({ packet, claimSupport, judgments = [], generator }) {
  assert(packet?.schema === SUPPORT_REVIEW_PACKET_SCHEMA && claimSupport?.schema === 'reploid.claim-support/v1', 'Invalid review inputs');
  validateGenerator(generator);
  const files = [];
  for (const file of judgments) files.push({ reviewer: file.reviewer, decided: await validateSupportJudgments({ packet, judgments: file, generator }) });
  const ids = files.map(file => `${file.reviewer.kind}:${file.reviewer.id}`);
  assert(new Set(ids).size === ids.length, 'Each reviewer submits one judgment file per packet');
  const claims = claimSupport.claims.map(claim => {
    const evidence = claim.citations.filter(citation => citation.valid).map(citation => ({ source: citation.marker, url: citation.url,
      passageHash: citation.passageHash, span: citation.span, ...(citation.document ? { document: citation.document } : {}) }));
    const base = { id: claim.id, text: claim.text, start: claim.start, end: claim.end, citations: claim.citations, evidence };
    if (!claim.reviewable) return { ...base, verdict: claim.verdict, reason: claim.reason, reviews: [], disputed: false };
    const reviews = files.flatMap(file => file.decided.has(claim.id)
      ? [{ reviewer: { kind: file.reviewer.kind, id: file.reviewer.id }, ...file.decided.get(claim.id) }] : []);
    const verdicts = new Set(reviews.map(review => review.verdict));
    if (!reviews.length) return { ...base, verdict: 'unverified', reason: 'awaiting-review', reviews, disputed: false };
    if (verdicts.size > 1) {
      const majority = [...verdicts].find(verdict => reviews.filter(review => review.verdict === verdict).length * 2 > reviews.length);
      return reviews.length >= 3 && majority
        ? { ...base, verdict: majority, reason: 'third-review', reviews, disputed: false }
        : { ...base, verdict: 'unverified', reason: 'disputed', reviews, disputed: true };
    }
    return { ...base, verdict: reviews[0].verdict, reason: 'reviewed', reviews, disputed: false };
  });
  const tally = name => claims.filter(claim => claim.verdict === name).length;
  return { schema: SUPPORT_RESULT_SCHEMA, packet: { id: packet.id, sha256: await supportPacketHash(packet) },
    reviewers: files.map(file => structuredClone(file.reviewer)), claims,
    summary: { claims: claims.length, supported: tally('supported'), unsupported: tally('unsupported'), unverified: tally('unverified'),
      disputed: claims.filter(claim => claim.disputed).length,
      resolvedByThirdReview: claims.filter(claim => claim.reason === 'third-review').length, awaitingReview: claims.filter(claim => claim.reason === 'awaiting-review').length,
      // Supported share of all material claims; unverified and disputed claims count against it.
      supportRate: claims.length ? tally('supported') / claims.length : null } };
}

/** The packet for human reading, in the style of the blinded answer-review packet. packet.json stays authoritative. */
export function renderSupportReviewPacketMarkdown(packet) {
  const fence = value => '```text\n' + String(value).replace(/```/g, '`​``') + '\n```';
  return [`# Citation support review packet ${packet.id}`, '',
    'Blinded: the packet names no model, adapter, execution route or contributor. Judge each claim against the cited passages only.', '',
    ...packet.instructions.map(line => `- ${line}`), '', '## Question', '', fence(packet.question), '', '## Answer', '', fence(packet.answer), '',
    '## Sources', '', ...packet.sources.flatMap(source => [`### [${source.number}] ${source.title}`, '',
      `- URL: ${source.url}`, `- Retrieved: ${new Date(source.retrievedAt).toISOString()}`, `- Passage sha256: \`${source.passageSha256}\``, '',
      fence(source.passage), '']),
    '## Claims', '', ...packet.claims.flatMap(claim => [`### ${claim.id}`, '', fence(claim.text), '',
      ...claim.citations.map(citation => `- Cites [${citation.source}]; suggested span ${citation.suggestedSpan.start}-${citation.suggestedSpan.end}: "${citation.suggestedSpan.text}"`),
      '', '| Verdict | Source | Span start | Span end | Basis |', '|---|---|---|---|---|', '| | | | | |', ''])].join('\n');
}
