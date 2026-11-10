/** Durable whole-model contribution references. The service owns validation,
 * settlement and issuance; this file retains no prompts or generated text. */
import { verifyReceipt } from '../packages/reploid/src/artifacts/receipt.js';
import { sha256Hex } from './hashing.js';

const STORE = 'whole-model-work';
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const assert = (ok, message) => { if (!ok) throw Error(message); };

export function createNativeWholeEarning({ storage, participantId, ownerPolicyDigest, findOffer, contributionFor, now }) {
  let queue = Promise.resolve();
  const serial = operation => {
    const running = queue.then(operation); queue = running.catch(() => {}); return running;
  };
  const read = async () => await storage.get(STORE) || [];
  return Object.freeze({
    async prepare({ model, requestId, consumer }) {
      assert(model.executionMode === 'whole-model' && text(requestId) && text(consumer), 'Whole-model admission identity required');
      model = structuredClone(model);
      const offer = await findOffer(model);
      assert(offer, 'Whole-model offer must be accepted before admitting requests');
      return serial(async () => {
        const rows = await read(), jobHash = `request:${requestId}`;
        const admissionKey = 'whole-admission:' + sha256Hex(JSON.stringify([participantId, consumer, requestId]));
        const prior = await storage.get(admissionKey);
        assert(!prior, 'Whole-model admission already recorded; do not repeat execution');
        const record = { jobHash, consumer, offerId: offer.offerId, model, startedAt: now(), receiptId: null, ownerPolicyDigest };
        // Keep the admission tombstone after the pending claim is retired, so a
        // replayed request cannot execute again following a contributor restart.
        await storage.set(admissionKey, record);
        await storage.set(STORE, [...rows, record]);
        return record;
      });
    },
    record(receipt) {
      receipt = structuredClone(receipt);
      return serial(async () => {
        if (receipt.version !== 2 || receipt.provider !== participantId || receipt.ownerPolicyDigest !== ownerPolicyDigest) return false;
        const verified = await verifyReceipt(receipt);
        assert(verified.providerValid && verified.consumerValid, 'Countersigned whole-model receipt required');
        const rows = await read(), record = rows.find(row => row.jobHash === receipt.jobHash && row.consumer === receipt.consumer);
        if (!record) return false; // No accepted offer was bound before this execution.
        assert(record.ownerPolicyDigest === receipt.ownerPolicyDigest && record.model.modelId === receipt.model
          && record.model.modelIdentity === receipt.modelIdentity && same(record.model.adapterIdentities, receipt.adapterIdentities),
        'Whole-model receipt changed the admitted model or owner policy');
        assert(!record.receiptId || record.receiptId === receipt.receiptId, 'Whole-model receipt identity changed');
        record.receiptId = receipt.receiptId;
        await storage.set(STORE, rows);
        return true;
      });
    },
    flush() {
      return serial(async () => {
        const rows = await read(), results = [], pending = [];
        for (const record of rows) {
          if (!record.receiptId) { pending.push(record); continue; }
          const [result] = await contributionFor(record.offerId).claimWholeModels([record]);
          results.push(result);
          if (result?.status !== 'done') pending.push(record);
        }
        await storage.set(STORE, pending);
        return results;
      });
    }
  });
}
