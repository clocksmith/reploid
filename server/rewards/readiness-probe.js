/**
 * @fileoverview Bounded readiness probe: real admission, execution and
 * settlement of a small probe attempt on the contracted stage.
 *
 * The probe drives the stage's normal ordered-stage ports, the same
 * `reserve`, `executeStage` and `closeAttempt` contract a coordinator uses
 * for demanded inference, so owner gates and reservation limits apply.
 * It reserves every promised admission slot, executes one bounded step,
 * checks the output through the prober's reference comparison (Doppler owns
 * the arithmetic and its tolerance), and settles every admitted attempt.
 * Stored bytes, declared state and signatures prove none of this.
 *
 * The prober port is host-owned:
 * - connect({ participantId, model, stageIndex, signal }) -> stage device
 *   { id, transportId, residentId, executionId, reserve, executeStage, closeAttempt }
 * - prepare({ stage, model, stageIndex, nonce, attemptIds, signal }) ->
 *   { identities, request } where identities bind each probe attempt to
 *   the stage and request carries the bounded one-step input
 * - verify({ stage, model, stageIndex, request, output, signal }) ->
 *   { ok, method, detail }
 */

import { canonicalRouteAttemptBinding, sameRouteAttemptIdentity } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { toMs } from '../ledger/domain.js';

export const PROBE_RECEIPT_SCHEMA = 'reploid.readiness-probe-receipt/v1';
const STAGE_KEYS = ['transportId', 'residentId', 'executionId'];

export const probeAttemptIds = (challenge, slots) => Array.from({ length: slots }, (_, index) => `${challenge.challengeId}-a${index}`);

const deadlineSignal = (ms) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('readiness probe deadline passed')), Math.max(0, ms));
  timer.unref?.();
  return { signal: controller.signal, stop: () => clearTimeout(timer) };
};

const bounded = (promise, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(signal.reason); return; }
  const abort = () => reject(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
});

/**
 * Run one probe and return its receipt. Never throws for stage behaviour:
 * every failure is a receipt reason. `clock()` measures against `respondBy`.
 */
export async function runReadinessProbe({ challenge, offer, prober, clock }) {
  const { participantId, stage: contracted } = offer.work;
  const { model, stageIndex } = contracted;
  const slots = offer.resourceBounds.attemptSlots.max;
  const receipt = {
    schema: PROBE_RECEIPT_SCHEMA,
    challengeId: challenge.challengeId,
    stage: null,
    admission: [],
    execution: null,
    verification: null,
    settlement: [],
    startedAt: clock(),
    finishedAt: null,
    reasons: [],
    withdrawn: false
  };
  const reject = (phase, message) => receipt.reasons.push(`${phase}: ${message}`);
  const owned = [];
  let device = null;
  const { signal, stop } = deadlineSignal(toMs(challenge.respondBy) - toMs(receipt.startedAt));
  try {
    device = await bounded(prober.connect({ participantId, model, stageIndex, signal }), signal);
    if (device?.id !== participantId || !STAGE_KEYS.every((key) => typeof device[key] === 'string' && device[key])
      || !['reserve', 'executeStage', 'closeAttempt'].every((method) => typeof device[method] === 'function')) {
      reject('connect', 'the prober did not reach the contracted participant\'s stage ports');
      return receipt;
    }
    const stage = { participantId: device.id, ...Object.fromEntries(STAGE_KEYS.map((key) => [key, device[key]])) };
    receipt.stage = stage;
    const attemptIds = probeAttemptIds(challenge, slots);
    let prepared;
    try {
      prepared = await bounded(prober.prepare({ stage, model, stageIndex, nonce: challenge.nonce, attemptIds, signal }), signal);
    } catch (error) {
      if (signal.aborted) throw error;
      // The prober's own input source failed before the stage was asked anything.
      receipt.withdrawn = true;
      reject('prober', `the prober could not prepare a probe: ${String(error?.message || error)}`);
      return receipt;
    }
    const { identities, request } = prepared ?? {};
    const bindings = (Array.isArray(identities) ? identities : []).map((identity) => {
      try {
        return canonicalRouteAttemptBinding(identity);
      } catch {
        return null;
      }
    });
    const routeStage = (binding) => binding?.route.stages[stageIndex];
    if (bindings.length !== slots || bindings.some((binding, index) => !binding || binding.attemptId !== attemptIds[index]
      || binding.route.modelId !== model.modelId || binding.route.modelIdentity !== model.modelIdentity || binding.route.planId !== model.planId
      || routeStage(binding)?.participantId !== stage.participantId || STAGE_KEYS.some((key) => routeStage(binding)?.[key] !== stage[key]))
      || request?.maxTokens !== 1) {
      reject('prepare', 'probe attempts are not bounded one-step attempts bound to the contracted stage');
      return receipt;
    }
    const step = { partitionIndex: stageIndex, inputTokenCount: request.inputTokenCount, maxTokens: 1,
      generationDigest: request.generationDigest, generation: request.generation, executionGrant: request.executionGrant };
    for (const identity of identities) {
      // Own the attempt before reserving: a lost acknowledgement is not a release.
      owned.push(identity);
      try {
        const ack = await bounded(device.reserve({ identity, ...step, signal }), signal);
        const admitted = sameRouteAttemptIdentity(ack?.identity, identity) && ack.partitionIndex === stageIndex && ack.status === 'reserved';
        receipt.admission.push({ attemptId: identity.attemptId, status: admitted ? 'reserved' : 'mismatch' });
        if (!admitted) {
          reject('admission', 'the stage acknowledgement does not bind the probe attempt');
          return receipt;
        }
      } catch (error) {
        receipt.admission.push({ attemptId: identity.attemptId, status: 'refused', code: error?.code ?? null });
        reject('admission', `the stage refused promised slot ${receipt.admission.length} of ${slots}`);
        return receipt;
      }
    }
    let output;
    try {
      output = await bounded(device.executeStage({ ...request, identity: identities[0], partitionIndex: stageIndex, step: 0, tokenPosition: 0, signal }), signal);
    } catch (error) {
      receipt.execution = { attemptId: identities[0].attemptId, completed: false, code: error?.code ?? null };
      reject('execution', 'the stage did not execute the probe step');
      return receipt;
    }
    const bound = sameRouteAttemptIdentity(output?.identity, identities[0]) && output.partitionIndex === stageIndex
      && output.step === 0 && output.tokenPosition === 0;
    receipt.execution = { attemptId: identities[0].attemptId, completed: bound };
    if (!bound) {
      reject('execution', 'the stage result does not bind the probe step');
      return receipt;
    }
    let verdict;
    try {
      verdict = await bounded(prober.verify({ stage, model, stageIndex, request, output, signal }), signal);
    } catch (error) {
      if (signal.aborted) throw error;
      verdict = { ok: false, method: 'unavailable', detail: { error: String(error?.message || error) } };
    }
    receipt.verification = {
      ok: verdict?.ok === true, method: String(verdict?.method ?? 'unspecified'),
      detail: verdict?.detail === undefined ? null : JSON.parse(JSON.stringify(verdict.detail))
    };
    if (verdict?.ok !== true) reject('verification', 'the stage output differs from the reference beyond its declared tolerance');
  } catch (error) {
    reject(signal.aborted ? 'deadline' : 'probe', signal.aborted ? 'the probe did not finish within the response window' : String(error?.message || error));
  } finally {
    stop();
    // Settle every owned probe attempt, including after a failure or a passed deadline;
    // each settlement gets one response window of its own.
    const settleWindowMs = toMs(challenge.respondBy) - toMs(challenge.issuedAt);
    for (const identity of owned) {
      const settle = deadlineSignal(settleWindowMs);
      try {
        await bounded(device.closeAttempt({ identity, partitionIndex: stageIndex }), settle.signal);
        receipt.settlement.push({ attemptId: identity.attemptId, status: 'settled' });
      } catch (error) {
        receipt.settlement.push({ attemptId: identity.attemptId, status: 'unknown', code: error?.code ?? null });
        reject('settlement', 'a probe attempt\'s cleanup is unconfirmed');
      } finally {
        settle.stop();
      }
    }
    receipt.finishedAt = clock();
    if (toMs(receipt.finishedAt) > toMs(challenge.respondBy) && !receipt.reasons.some((reason) => reason.startsWith('deadline'))) {
      reject('deadline', 'the probe did not finish within the response window');
    }
  }
  return receipt;
}

export const probePassed = (receipt, slots) => !receipt.withdrawn && receipt.reasons.length === 0
  && receipt.admission.length === slots && receipt.admission.every((entry) => entry.status === 'reserved')
  && receipt.execution?.completed === true && receipt.verification?.ok === true
  && receipt.settlement.length === slots && receipt.settlement.every((entry) => entry.status === 'settled');

export default { runReadinessProbe, probePassed };
