/**
 * Contributor claims through an earning client.
 *
 * A stage share is claimed from this resident's own settled admission record;
 * the service finds the requester's reported route for it and validates the
 * share against that settlement. A delivery this host supplied is claimed by
 * the id both parties derive from the grant, once its acquirer submitted the
 * attested evidence; a delivery this host acquired has its evidence submitted.
 * Claims wait in the client's durable outbox with stable keys, so a restarted
 * host neither loses nor doubles them. A claim refused only because its
 * evidence is not reported yet is tried again later under a new key; the
 * service still pays each unit of work once.
 *
 * A charged attempt this resident closed carries its signed receipt and the
 * latest requester acknowledgment it was forwarded; that evidence is submitted
 * once per closed receipt, so the requester's report is not the only record
 * of the work.
 */
import { deliveryEvidenceFromRecord, deliveryEvidenceId } from '../../vendor/reploid/artifacts/delivery-attestation.js';

const LATER = new Set(['attempt_record_not_found', 'delivery_not_found', 'work_not_settled']);
const DONE = 'done';
const claimState = key => `claims:${key}`;

/**
 * @param {object} options
 * @param {object} options.client createEarningClient(...) result for this contributor device
 * @param {object} options.offers explicit accepted offer ids: { stageShare?, delivery? }
 * @param {string} options.ownerPolicyDigest digest of the owner policy this host contributes under
 * @param {Function} options.hashEvidence (authorization) -> its custody evidence hash (hashDopplerEvidence)
 */
export function createEarningContribution({ client, offers = {}, ownerPolicyDigest, hashEvidence } = {}) {
  if (!client || typeof client.send !== 'function') throw new TypeError('Earning contribution requires an enabled earning client');
  if (typeof ownerPolicyDigest !== 'string' || !ownerPolicyDigest) throw new TypeError('Earning contribution requires the owner policy in force');
  if (typeof hashEvidence !== 'function') throw new TypeError('Earning contribution requires the custody evidence hash');
  const { storage } = client;
  let flushing = Promise.resolve();

  /** One claim attempt per unit; a refusal that only means "not yet" allows a later try under a new key. */
  async function claim(unitKey, offerId, body) {
    const state = (await storage.get(claimState(unitKey))) ?? { tries: 0, status: 'open' };
    if (state.status === DONE) return state;
    const opId = `claim:${offerId}:${unitKey}:${state.tries}`;
    try {
      const answer = await client.send({ opId, path: `/offers/${encodeURIComponent(offerId)}/claims`, body });
      const reasons = answer.validation?.reasons?.map(reason => reason.code) ?? [];
      const later = answer.validation?.outcome === 'rejected' && reasons.length > 0 && reasons.every(code => LATER.has(code));
      const next = later ? { tries: state.tries + 1, status: 'open' }
        : { tries: state.tries, status: DONE, outcome: answer.validation?.outcome ?? null, issuance: answer.issuance?.status ?? null };
      await storage.set(claimState(unitKey), next);
      return next;
    } catch (error) {
      if (error.pending) return { ...state, status: 'pending' };
      const next = LATER.has(error.code) ? { tries: state.tries + 1, status: 'open' } : { tries: state.tries, status: DONE, refused: error.code };
      await storage.set(claimState(unitKey), next);
      return next;
    }
  }

  /** Signed evidence of charged attempts this resident closed, from its admission records. */
  async function submitEvidence(records = []) {
    const results = [];
    for (const record of records) {
      const bundle = record?.evidence;
      const receipt = bundle?.receipts?.[0];
      if (record?.participantId !== client.participantId || !receipt || receipt.status === 'executing') continue;
      const unitKey = `attempt-evidence:${bundle.reservationId}:${bundle.attemptId}:${record.index}:${receipt.sequence}:${bundle.acknowledged?.acknowledgment.count ?? 0}`;
      const state = await storage.get(claimState(unitKey));
      if (state?.status === DONE) continue;
      try {
        const kept = await client.send({ opId: unitKey, path: '/attempt-evidence', body: { evidence: structuredClone(bundle) } });
        await storage.set(claimState(unitKey), { status: DONE, evidenceId: kept.evidenceId });
        results.push({ unitKey, status: DONE, evidenceId: kept.evidenceId, rejected: kept.rejected ?? [] });
      } catch (error) {
        if (!error.pending) await storage.set(claimState(unitKey), { status: DONE, refused: error.code });
        results.push({ unitKey, status: error.pending ? 'pending' : DONE, code: error.code });
      }
    }
    return results;
  }

  /** Stage shares from this participant's settled admission records. */
  async function claimStageShares(records = []) {
    if (!offers.stageShare) return [];
    const results = [];
    for (const record of records) {
      if (record?.participantId !== client.participantId || record.phase !== 'settled' || record.failure != null || !record.identity) continue;
      const unitKey = `stage:${record.identity.attemptId}:${record.index}`;
      // The signed evidence travels separately (submitEvidence); the claim carries the admission record.
      const { evidence: _evidence, ...admission } = record;
      results.push({ unitKey, ...await claim(unitKey, offers.stageShare, {
        stageIndex: record.index, contribution: { admission: structuredClone(admission), ownerPolicyDigest }
      }) });
    }
    return results;
  }

  /** Acquired deliveries: submit the attested evidence. Supplied deliveries: claim them. */
  async function settleDeliveries(records = []) {
    const results = [];
    for (const record of records) {
      if (record?.role === 'requester' && record.attestation) {
        const evidence = deliveryEvidenceFromRecord(record);
        const unitKey = `evidence:${record.transferId}:${evidence.artifactId}`;
        const state = await storage.get(claimState(unitKey));
        if (state?.status === DONE) continue;
        try {
          const kept = await client.send({ opId: `delivery:${record.transferId}:${evidence.artifactId}`, path: '/deliveries', body: evidence });
          await storage.set(claimState(unitKey), { status: DONE, deliveryId: kept.deliveryId });
          results.push({ unitKey, status: DONE, deliveryId: kept.deliveryId });
        } catch (error) {
          if (!error.pending) await storage.set(claimState(unitKey), { status: DONE, refused: error.code });
          results.push({ unitKey, status: error.pending ? 'pending' : DONE, code: error.code });
        }
      } else if (record?.role === 'supplier' && offers.delivery) {
        const artifactId = record.authorization?.artifactSet?.artifacts?.[0]?.artifactId;
        if (typeof artifactId !== 'string') continue;
        const deliveryId = await deliveryEvidenceId({ authorizationHash: await hashEvidence(record.authorization), artifactId });
        const unitKey = `delivery:${deliveryId}`;
        results.push({ unitKey, ...await claim(unitKey, offers.delivery, { deliveryId }) });
      }
    }
    return results;
  }

  return Object.freeze({
    /** Accept an offer made to this account under the owner policy in force. */
    async acceptOffer(offerId, ownerAuthorization) {
      if (ownerAuthorization?.digest !== ownerPolicyDigest) throw new TypeError('Offers are accepted under the owner policy this host runs');
      const offer = await client.get(`/offers/${encodeURIComponent(offerId)}`);
      return client.send({ opId: `accept-offer:${offerId}`, path: `/offers/${encodeURIComponent(offerId)}/accept`,
        body: { offerHash: offer.offerHash, ownerAuthorization }, durable: false });
    },
    /** Record this native device's owner grants from its own session. */
    async recordOwnerAuthorization(ownerAuthorization) {
      if (ownerAuthorization?.digest !== ownerPolicyDigest) throw new TypeError('Record the owner policy this host runs');
      const { deviceId } = await client.ensureSession();
      return client.send({ opId: `owner:${deviceId}:${ownerPolicyDigest}`, method: 'PUT',
        path: `/devices/${encodeURIComponent(deviceId)}/owner-authorization`, body: { ownerAuthorization }, durable: false });
    },
    submitEvidence,
    claimStageShares,
    settleDeliveries,
    /** Submit evidence, then claim everything new in the host's current records; calls run one at a time. */
    observe({ admissions = [], deliveries = [] } = {}) {
      const run = flushing.then(async () => ({ evidence: await submitEvidence(admissions), stages: await claimStageShares(admissions),
        deliveries: await settleDeliveries(deliveries) }));
      flushing = run.catch(() => {});
      return run;
    },
    reconcile: () => client.reconcile()
  });
}

export default createEarningContribution;
