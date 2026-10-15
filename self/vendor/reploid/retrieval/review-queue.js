/** A blinded human review queue for citation support. Each entry keeps the packet reviewers see apart from the
 * sealed generator identity, which only checks independence and is never shown. Two human reviewers judge every
 * claim; claims they disagree on are listed for a third reviewer, whose review decides them by majority. */
import { SUPPORT_JUDGMENTS_SCHEMA, applySupportJudgments, assertIndependentReviewer, supportPacketHash,
  validateGenerator, validateSupportJudgments } from './support-review.js';

export const REVIEW_QUEUE_SCHEMA = 'reploid.claim-support-review-queue/v1';
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const copy = value => structuredClone(value);
const memory = () => { let saved = null; return { load: () => saved, save: value => { saved = copy(value); } }; };

/** `store` persists the queue: `{ load(): state | null, save(state) }`. Required reviews default to two. */
export function createHumanReviewQueue({ store = memory(), now = Date.now, requiredReviews = 2 } = {}) {
  assert(typeof store?.load === 'function' && typeof store?.save === 'function', 'Review queue store required');
  assert(Number.isSafeInteger(requiredReviews) && requiredReviews > 0, 'Invalid required review count');
  const loaded = store.load();
  assert(!loaded || loaded.schema === REVIEW_QUEUE_SCHEMA && Array.isArray(loaded.entries), 'Invalid stored review queue');
  const entries = copy(loaded?.entries || []);
  const save = () => store.save({ schema: REVIEW_QUEUE_SCHEMA, entries });
  const entry = id => { const found = entries.find(item => item.packet.id === id); assert(found, 'Review packet not found'); return found; };
  const disagreements = async item => {
    const files = [];
    for (const file of item.judgments) files.push(await validateSupportJudgments({ packet: item.packet, judgments: file, generator: item.generator }));
    return item.packet.claims.filter(claim => new Set(files.flatMap(decided => decided.has(claim.id) ? [decided.get(claim.id).verdict] : [])).size > 1)
      .map(claim => claim.id);
  };
  const queue = Object.freeze({
    id: 'reploid.human-support-review', version: '1', kind: 'human-queue',
    /** Reviewer interface: queues the packet and returns null, because human judgments arrive later through submit(). */
    async review(packet, { generator, claimSupport }) {
      validateGenerator(generator);
      assert(!entries.some(item => item.packet.id === packet.id), 'Review packet already queued');
      entries.push({ packet: copy(packet), sha256: await supportPacketHash(packet), generator: validateGenerator(generator),
        claimSupport: copy(claimSupport), queuedAt: now(), judgments: [] });
      save();
      return null;
    },
    /** Packets still needing a review, without their sealed generator identity. */
    async pending() {
      const waiting = [];
      for (const item of entries) {
        const third = (await disagreements(item)).length > 0 && item.judgments.length === requiredReviews;
        if (item.judgments.length < requiredReviews || third) waiting.push({ packet: copy(item.packet), sha256: item.sha256,
          reviews: item.judgments.length, ...(third ? { thirdReviewClaims: await disagreements(item) } : {}) });
      }
      return waiting;
    },
    packet: id => copy(entry(id).packet),
    /** Accepts one human reviewer's judgment file; the generator never reviews, and a reviewer submits once per packet. */
    async submit(judgments) {
      assert(judgments?.schema === SUPPORT_JUDGMENTS_SCHEMA && judgments.reviewer?.kind === 'human', 'The queue accepts human judgment files');
      const item = entry(judgments.packet?.id);
      assertIndependentReviewer(judgments.reviewer, item.generator);
      assert(!item.judgments.some(file => file.reviewer.id === judgments.reviewer.id), 'This reviewer already judged the packet');
      const limit = requiredReviews + ((await disagreements(item)).length ? 1 : 0);
      assert(item.judgments.length < limit, 'This packet needs no further review');
      await validateSupportJudgments({ packet: item.packet, judgments, generator: item.generator });
      item.judgments.push({ ...copy(judgments), receivedAt: now() });
      save();
      return queue.status(item.packet.id);
    },
    async status(id) {
      const item = entry(id), disputed = await disagreements(item);
      return { packetId: id, reviews: item.judgments.length, requiredReviews, disagreements: disputed,
        needsThirdReview: disputed.length > 0 && item.judgments.length === requiredReviews,
        complete: item.judgments.length >= requiredReviews && (!disputed.length || item.judgments.length > requiredReviews) };
    },
    /** The per-claim result from every judgment received so far. */
    result(id) {
      const item = entry(id);
      return applySupportJudgments({ packet: item.packet, claimSupport: item.claimSupport,
        judgments: item.judgments.map(({ receivedAt, ...file }) => file), generator: item.generator });
    }
  });
  return queue;
}
