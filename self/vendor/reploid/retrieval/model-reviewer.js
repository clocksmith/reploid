/** A stronger-model entailment reviewer. Off unless a host configures it: the host names the reviewer's provider and
 * model, the generating models it is declared stronger than, and a `complete` port that reaches that model.
 * Sending a packet to it discloses the question, the answer and the cited passages to that provider; this is a
 * separate disclosure from search and from execution contributors, so hosts use it only for evaluation material
 * they may send there. It never reviews an answer from its own model or from a model it is not declared stronger than. */
import { SUPPORT_JUDGMENTS_SCHEMA, assertIndependentReviewer, supportPacketHash, validateGenerator } from './support-review.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const named = value => typeof value === 'string' && value.trim() && value.length <= 256;
const normalized = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');

export const MODEL_REVIEWER_SYSTEM = 'You review whether cited source passages support claims in an answer. You judge only against the recorded passages, never your own knowledge. You reply with JSON only.';

export function renderModelReviewPrompt(packet) {
  return [...packet.instructions, '',
    'Reply with one JSON object: {"judgments":[{"claim":"<claim id>","verdict":"supported|unsupported|unverified","basis":"<one or two sentences>","spans":[{"source":<number>,"quote":"<exact text copied from that passage>"}]}]}.',
    'Include every claim id once. For supported, quote the exact passage text you relied on; quotes must match the passage character for character.', '',
    `Question:\n${packet.question}`, '', `Answer:\n${packet.answer}`, '',
    'Sources:', ...packet.sources.map(source => `[${source.number}] ${source.title}\n${source.url}\n<<<\n${source.passage}\n>>>`), '',
    'Claims:', ...packet.claims.map(claim => `${claim.id}: ${claim.text}\n  cites: ${claim.citations.map(citation =>
      `[${citation.source}] suggested span "${citation.suggestedSpan.text}"`).join('; ')}`)].join('\n');
}

function parseJudgments(reply) {
  const body = String(reply), start = body.indexOf('{'), end = body.lastIndexOf('}');
  assert(start >= 0 && end > start, 'The reviewer model returned no JSON judgments');
  const parsed = JSON.parse(body.slice(start, end + 1));
  assert(Array.isArray(parsed?.judgments), 'The reviewer model returned no judgments list');
  return parsed.judgments.map(item => ({ claim: item?.claim, verdict: item?.verdict, basis: item?.basis,
    spans: Array.isArray(item?.spans) ? item.spans.map(span => ({ source: span?.source, quote: span?.quote })) : [] }));
}

/**
 * `identity`: `{ provider, model, version?, identity? }` of the reviewer. `strongerThan`: generating model ids or
 * content identities this reviewer is explicitly declared stronger than. `complete({ system, prompt, signal })`
 * returns the model's text reply.
 */
export function createModelSupportReviewer({ identity, strongerThan, complete, maxReplyCharacters = 200000 } = {}) {
  assert(identity && named(identity.provider) && named(identity.model), 'A model reviewer is off unless its provider and model are configured');
  assert(Array.isArray(strongerThan) && strongerThan.length && strongerThan.every(named),
    'A model reviewer must name the generating models it is stronger than');
  assert(typeof complete === 'function', 'A model reviewer needs a completion port');
  const reviewer = Object.freeze({ kind: 'model', id: `${identity.provider}/${identity.model}`,
    model: { provider: identity.provider, name: identity.model, version: identity.version ?? null, ...(identity.identity ? { identity: identity.identity } : {}) } });
  return Object.freeze({
    id: 'reploid.model-support-reviewer', version: '1', kind: 'model', reviewer,
    async review(packet, { generator, signal = null } = {}) {
      const made = validateGenerator(generator);
      assertIndependentReviewer(reviewer, made);
      assert(strongerThan.some(value => value === made.modelIdentity || normalized(value) === normalized(made.modelId)),
        'This reviewer is not configured as stronger than the generating model');
      const reply = await complete({ system: MODEL_REVIEWER_SYSTEM, prompt: renderModelReviewPrompt(packet), signal });
      assert(typeof reply === 'string' && reply.length <= maxReplyCharacters, 'The reviewer model reply is missing or too long');
      return { schema: SUPPORT_JUDGMENTS_SCHEMA, packet: { id: packet.id, sha256: await supportPacketHash(packet) },
        reviewer: structuredClone(reviewer), judgments: parseJudgments(reply) };
    }
  });
}
