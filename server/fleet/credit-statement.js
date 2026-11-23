/**
 * Offline service-credit statement verifier.
 *
 * Recomputes one enrolled computer's balance directly from signed execution
 * receipts, output acknowledgments, terminal cleanup proofs and accepted
 * request bindings, without trusting the operator's running total or SQLite
 * tables. Any journal entry whose evidence is missing, unsigned, replayed or
 * inconsistent with its stated delta is reported in `unchecked`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { canonicalize } from '../../packages/reploid/src/artifacts/canonical-json.js';
import { verifyParticipantSignature } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { canonicalRouteAttemptBinding } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { assert, creditPolicy, digest, enrollComputers, FLEET_SERVICE_REQUEST_SCHEMA, integer, same, text } from './contract.js';
import { verifyCreditEvidence, verifyPartitionComponents } from './credit-evidence.js';
import { creditSettlementDeltas } from './credit-shares.js';

export const FLEET_CREDIT_STATEMENT_SCHEMA = 'reploid.fleet-credit-statement/v1';

function verifyRequestBinding(request, requestId, enrollment, policy) {
  assert(request && typeof request === 'object' && !Array.isArray(request)
    && request.id === requestId && text(request.executionId)
    && ['whole-model', 'partition'].includes(request.mode)
    && text(request.model?.id) && digest(request.model.identity)
    && Array.isArray(request.model.adapterIdentities) && request.model.adapterIdentities.every(digest)
    && digest(request.inputDigest)
    && (request.settingsDigest === undefined || digest(request.settingsDigest) && request.mode === 'whole-model')
    && (request.admission === undefined || request.mode === 'whole-model'
      && request.admission?.schema === 'reploid.credit-preadmission/v1'
      && digest(request.admission.commitment) && Object.keys(request.admission).length === 2)
    && integer(request.maxOutputTokens) && request.maxOutputTokens > 0
    && (request.policyVersion !== policy.version || request.maxOutputTokens <= policy.maxOutputTokens)
    && Array.isArray(request.providers) && request.providers.length > 0 && request.providers.length <= 128,
  'Malformed request binding');
  const consumer = enrollment.byPeer.get(request.consumer);
  assert(consumer && consumer.computerId === request.computerId, 'Request consumer differs from enrolled computer');
  let totalWeight = 0;
  for (const provider of request.providers) {
    const owner = enrollment.byPeer.get(provider?.participantId);
    assert(owner && integer(provider.weight) && provider.weight > 0
      && (request.mode === 'partition' || owner.computerId !== consumer.computerId)
      && (policy.allowSameOwner || owner.ownerId !== consumer.ownerId), 'Ineligible credited provider in request binding');
    totalWeight += provider.weight;
  }
  assert(Number.isSafeInteger(totalWeight), 'Invalid total stage weight');
  if (request.mode === 'whole-model') {
    assert(request.providers.length === 1 && request.route === undefined, 'Whole-model credit needs one provider');
  } else {
    const canonicalRoute = canonicalRouteAttemptBinding(request.route);
    assert(same(request.route, canonicalRoute) && canonicalRoute.attemptId === request.executionId, 'Partition attempt binding differs');
    const recipients = canonicalRoute.route.stages.map(stage => stage.participantId);
    assert(same(recipients, request.providers.map(row => row.participantId))
      && canonicalRoute.requesterId === request.consumer
      && canonicalRoute.route.modelId === request.model.id
      && canonicalRoute.route.modelIdentity === request.model.identity, 'Partition credit recipients or model differ');
  }
  const {
    requestHash, computerId: _computerId, maximum, policyVersion: _policyVersion,
    terminalCharge, terminalPolicyVersion: _terminalPolicyVersion, admissionVersion: _admissionVersion,
    createdAt, deadline, ...reservedValue
  } = request;
  const expectedHash = createHash('sha256').update(canonicalize(reservedValue)).digest('hex');
  assert(typeof requestHash === 'string' && requestHash === expectedHash, 'Request binding hash mismatch');
  assert(Number.isSafeInteger(createdAt) && deadline === createdAt + policy.maxRequestMs
    && maximum === request.maxOutputTokens * policy.creditsPerOutputToken
    && (terminalCharge === null || request.mode === 'whole-model' && terminalCharge === 0),
  'Request ceiling or deadline differs from policy terms');
}

async function verifyInterruptedOwners(request, evidence, enrollment, settledAt, skew) {
  if (request.mode !== 'partition' || !Array.isArray(evidence?.interruptedOwners) || evidence.interruptedOwners.length === 0) {
    return [];
  }
  assert(evidence.interruptedOwners.length <= request.providers.length, 'Bounded interrupted stage closures required');
  const seenStages = new Set(), verified = [];
  for (const envelope of evidence.interruptedOwners) {
    assert(envelope && typeof envelope === 'object' && !Array.isArray(envelope), 'Malformed stage owner closure');
    const { signature, ...signed } = envelope;
    const { id, partitionIndex: stage, owner, receipt } = signed.payload || {};
    const enrolled = enrollment.byPeer.get(signed.participantId);
    assert(signed.schema === FLEET_SERVICE_REQUEST_SCHEMA && signed.operation === 'closeStageOwner'
      && Number.isSafeInteger(signed.at) && signed.at >= request.createdAt - skew && signed.at <= settledAt + skew
      && enrolled && await verifyParticipantSignature(enrolled.publicJwk, FLEET_SERVICE_REQUEST_SCHEMA, signed, signature),
    'Enrolled stage owner signature required');
    assert(Object.keys(signed.payload).length === 4 && id === request.id
      && typeof owner === 'string' && /^[a-f0-9]{64}$/.test(owner)
      && Number.isSafeInteger(stage) && stage >= 0 && !seenStages.has(stage)
      && request.providers[stage]?.participantId === signed.participantId,
    'Unmatched interrupted stage owner closure');
    assert(receipt === null || receipt?.partitionIndex === stage && receipt.status === 'executing', 'Invalid recovered step checkpoint');
    if (receipt) {
      await verifyPartitionComponents(request, { identity: request.route, receipts: [receipt] }, enrollment, settledAt, skew);
    }
    seenStages.add(stage);
    verified.push({ stage, closure: envelope });
  }
  return verified;
}

/**
 * Recompute an account's service-credit balance offline from signed evidence.
 *
 * Pass `computers` to pin an external enrollment file, or `participantIds` to
 * pin the contributor's own signing identities without needing the full fleet
 * registry. Entries that lack complete cryptographic proof or disagree with
 * the stated journal delta are reported in `unchecked`.
 */
export async function verifyCreditStatement(statement, { computers, participantIds } = {}) {
  assert(statement?.schema === FLEET_CREDIT_STATEMENT_SCHEMA, 'Explicit fleet credit statement required');
  assert(text(statement.computerId), 'Explicit statement computer ID required');
  const policy = creditPolicy(statement.policy);
  assert(statement.unit === policy.unit, 'Statement credit unit differs from policy');
  assert(Number.isSafeInteger(statement.balance) && integer(statement.held) && Number.isSafeInteger(statement.issuedAt),
    'Explicit integer statement balance, hold and issue time required');
  assert(Array.isArray(statement.entries), 'Statement entries array required');
  const enrolledSource = computers ?? statement.computers;
  assert(enrolledSource, 'Computer enrollment required to verify credit statement');
  const enrollment = await enrollComputers(enrolledSource);
  if (computers !== undefined && statement.computers !== undefined) {
    assert(same(computers, statement.computers), 'Statement enrollment differs from trusted computer enrollment');
  }
  const account = enrollment.byId.get(statement.computerId);
  assert(account, 'Statement account is absent from enrollment');
  if (participantIds !== undefined) {
    assert(Array.isArray(participantIds) && participantIds.length > 0 && participantIds.every(text),
      'Explicit participant IDs required');
    const expectedPeers = [...new Set(participantIds)].sort();
    const actualPeers = account.providers.map(provider => provider.participantId).sort();
    assert(same(actualPeers, expectedPeers), 'Statement account keys differ from expected participant identities');
  }

  const seenRequests = new Set(), seenWorkIds = new Set();
  const verified = [], unchecked = [];
  let previousSequence = 0, recomputedBalance = 0;

  for (const entry of statement.entries) {
    const sequence = Number.isSafeInteger(entry?.sequence) ? entry.sequence : null;
    const requestId = typeof entry?.requestId === 'string' ? entry.requestId : null;
    const statedDelta = Number.isSafeInteger(entry?.delta) ? entry.delta : null;
    let recomputedDelta = null;
    try {
      assert(sequence !== null && sequence > previousSequence, 'Non-monotonic or invalid journal sequence');
      previousSequence = sequence;
      assert(text(requestId) && !seenRequests.has(requestId), 'Duplicate or invalid request ID');
      assert(statedDelta !== null && Number.isSafeInteger(entry.at), 'Explicit integer journal delta and timestamp required');
      verifyRequestBinding(entry.request, requestId, enrollment, policy);
      assert(entry.at >= entry.request.createdAt - policy.maxClockSkewMs
        && entry.at <= statement.issuedAt + policy.maxClockSkewMs, 'Journal timestamp is outside request or statement bounds');
      assert(entry.evidence !== null && entry.evidence !== undefined, 'Missing signed settlement evidence');
      const interrupted = await verifyInterruptedOwners(entry.request, entry.evidence, enrollment, entry.at, policy.maxClockSkewMs);
      const observed = await verifyCreditEvidence(entry.request, entry.evidence, enrollment, entry.at, policy.maxClockSkewMs, { interrupted });
      assert(!observed.terminalStatus || integer(observed.fixedCharge), 'Accepted fixed terminal terms required');
      for (const workId of observed.workIds) {
        assert(!seenWorkIds.has(workId), 'Duplicate settled work evidence');
      }
      const totalUnits = observed.fixedCharge ?? observed.outputTokens * policy.creditsPerOutputToken;
      const split = creditSettlementDeltas(entry.request, totalUnits, peer => enrollment.byPeer.get(peer).computerId);
      assert(split.deltas.has(statement.computerId), 'Journal entry account did not participate in settled request');
      recomputedDelta = split.deltas.get(statement.computerId);
      assert(Number.isSafeInteger(recomputedBalance + recomputedDelta), 'Recomputed credit balance exceeds integer precision');
      seenRequests.add(requestId);
      for (const workId of observed.workIds) seenWorkIds.add(workId);
      recomputedBalance += recomputedDelta;
      if (entry.outcome !== null && entry.outcome !== undefined) {
        assert(entry.outcome.charge === split.charge && entry.outcome.ownComputeUnits === split.ownComputeUnits
          && same(entry.outcome.credits, split.credits), 'Recorded settlement outcome differs from recomputed shares');
      }
      assert(recomputedDelta === statedDelta, 'Stated journal delta differs from recomputed share');
      verified.push({
        sequence,
        requestId,
        delta: recomputedDelta,
        outputTokens: observed.outputTokens,
        charge: split.charge,
        ownComputeUnits: split.ownComputeUnits,
      });
    } catch (error) {
      unchecked.push({
        sequence,
        requestId,
        statedDelta,
        recomputedDelta,
        reason: error.message,
      });
    }
  }

  const balanceMatches = recomputedBalance === statement.balance;
  return {
    ok: unchecked.length === 0 && balanceMatches,
    computerId: statement.computerId,
    unit: policy.unit,
    statedBalance: statement.balance,
    recomputedBalance,
    balanceMatches,
    held: statement.held,
    entryCount: statement.entries.length,
    verifiedCount: verified.length,
    uncheckedCount: unchecked.length,
    verified,
    unchecked,
  };
}

const entered = typeof import.meta.main === 'boolean' ? import.meta.main
  : (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();

if (entered) {
  const [statementFile, enrollmentFile] = process.argv.slice(2);
  assert(statementFile && path.isAbsolute(statementFile),
    'Usage: node server/fleet/credit-statement.js /absolute/statement.json [/absolute/enrollment.json]');
  const statement = JSON.parse(await fs.readFile(statementFile, 'utf8'));
  const computers = enrollmentFile ? JSON.parse(await fs.readFile(path.resolve(enrollmentFile), 'utf8')) : undefined;
  const result = await verifyCreditStatement(statement, { ...(computers ? { computers } : {}) });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
