/**
 * Offline service-credit statement verifier.
 *
 * Recomputes one owner account's balance (statement v2) or, for a statement
 * issued before owner accounts, one enrolled computer's balance (v1) directly from signed execution
 * receipts, output acknowledgments, terminal cleanup proofs and accepted
 * request bindings, without trusting the operator's running total or SQLite
 * tables. Verifies expired unclaimed holds, enforces policy claim-release
 * windows so late receipts cannot reopen settlement, and reports any journal
 * entry whose proof is missing, unsigned, replayed or mismatched in `unchecked`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { canonicalize } from '../../shared/vendor/reploid/artifacts/canonical-json.js';
import { verifyParticipantSignature } from '../../shared/vendor/reploid/artifacts/participant-proofs.js';
import { canonicalRouteAttemptBinding } from '../../shared/vendor/reploid/mesh/partitions/partition-contract.js';
import { assert, creditPolicy, digest, enrollComputers, FLEET_SERVICE_REQUEST_SCHEMA, integer, same, text } from './contract.js';
import { verifyCreditEvidence, verifyPartitionComponents } from './credit-evidence.js';
import { accountSettlement, creditSettlementDeltas, settledCreditUnits, UNFINISHED_ANSWER_TERMS } from './credit-shares.js';

export const FLEET_CREDIT_STATEMENT_SCHEMA = 'reploid.fleet-credit-statement/v1';
export const FLEET_CREDIT_STATEMENT_V2_SCHEMA = 'reploid.fleet-credit-statement/v2';

const releaseWindowFor = (request, policy) => (
  request.mode === 'whole-model' ? policy.wholeModelUnclaimedReleaseMs : policy.partitionUnclaimedReleaseMs
);

const requestWorkIds = request => (
  request.mode === 'whole-model'
    ? [`whole:${request.providers[0].participantId}:${request.consumer}:request:${request.executionId}`]
    : request.providers.map((provider, index) => `stage:${provider.participantId}:${request.id}:${request.executionId}:${index}`)
);

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
  assert(request.accountId === undefined || request.accountId === consumer.ownerId, 'Request account differs from the enrolled owner');
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
    requestHash, computerId: _computerId, accountId: _accountId, maximum, policyVersion: _policyVersion,
    terminalCharge, terminalPolicyVersion: _terminalPolicyVersion, admissionVersion: _admissionVersion,
    createdAt, deadline, ...reservedValue
  } = request;
  const expectedHash = createHash('sha256').update(canonicalize(reservedValue)).digest('hex');
  assert(typeof requestHash === 'string' && requestHash === expectedHash, 'Request binding hash mismatch');
  assert(Number.isSafeInteger(createdAt) && deadline === createdAt + policy.maxRequestMs
    && maximum === request.maxOutputTokens * policy.creditsPerOutputToken
    && (terminalCharge === null || request.mode === 'whole-model' && terminalCharge === 0)
    && (request.unfinishedTerms === undefined || request.mode === 'partition' && request.unfinishedTerms === UNFINISHED_ANSWER_TERMS),
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
 * Pass `computers` to pin an external enrollment file, `participantIds` to pin
 * the contributor's own signing identities without needing the full fleet
 * registry, or `lateClaims` (`[{ requestId, evidence, at, request? }]`) to
 * verify offline that late receipts arriving after hold expiry cannot reopen
 * settlement. Entries that lack complete cryptographic proof or disagree with
 * the stated journal delta are reported in `unchecked`.
 */
export async function verifyCreditStatement(statement, { computers, participantIds, lateClaims } = {}) {
  assert([FLEET_CREDIT_STATEMENT_SCHEMA, FLEET_CREDIT_STATEMENT_V2_SCHEMA].includes(statement?.schema), 'Explicit fleet credit statement required');
  // v2: the balance belongs to an owner account across all its computers. v1: to one computer.
  const perAccount = statement.schema === FLEET_CREDIT_STATEMENT_V2_SCHEMA;
  const holder = perAccount ? statement.accountId : statement.computerId;
  assert(text(holder), perAccount ? 'Explicit statement account ID required' : 'Explicit statement computer ID required');
  const policy = creditPolicy(statement.policy);
  assert(statement.unit === policy.unit, 'Statement credit unit differs from policy');
  assert(Number.isSafeInteger(statement.balance) && integer(statement.held) && Number.isSafeInteger(statement.issuedAt),
    'Explicit integer statement balance, hold and issue time required');
  assert(Array.isArray(statement.entries), 'Statement entries array required');
  assert(statement.expired === undefined || Array.isArray(statement.expired), 'Statement expired list must be an array');
  const enrolledSource = computers ?? statement.computers;
  assert(enrolledSource, 'Computer enrollment required to verify credit statement');
  const enrollment = await enrollComputers(enrolledSource);
  if (computers !== undefined && statement.computers !== undefined) {
    assert(same(computers, statement.computers), 'Statement enrollment differs from trusted computer enrollment');
  }
  const owned = perAccount ? [...enrollment.byId.values()].filter(computer => computer.ownerId === holder)
    : [enrollment.byId.get(holder)].filter(Boolean);
  assert(owned.length > 0, 'Statement account is absent from enrollment');
  if (perAccount) {
    assert(same(statement.computerIds, owned.map(computer => computer.id)), 'Statement computers differ from the enrolled owner account');
  }
  if (participantIds !== undefined) {
    assert(Array.isArray(participantIds) && participantIds.length > 0 && participantIds.every(text),
      'Explicit participant IDs required');
    const expectedPeers = [...new Set(participantIds)].sort();
    const actualPeers = owned.flatMap(computer => computer.providers.map(provider => provider.participantId)).sort();
    assert(same(actualPeers, expectedPeers), 'Statement account keys differ from expected participant identities');
  }
  // The unit a participant's share is posted to, and the unit a reservation's hold sits on.
  const unitOfPeer = peer => { const enrolled = enrollment.byPeer.get(peer); return perAccount ? enrolled?.ownerId : enrolled?.computerId; };
  const holdUnit = request => (perAccount ? request.accountId ?? enrollment.byId.get(request.computerId)?.ownerId : request.computerId);
  const placeOf = peer => { const { computerId, ownerId } = enrollment.byPeer.get(peer); return { computerId, accountId: ownerId }; };
  /** This statement's share of one settled request: its delta, and for v2 the computers that delta is attributed to. */
  const shareOf = (request, totalUnits) => {
    if (!perAccount) {
      const split = creditSettlementDeltas(request, totalUnits, peer => enrollment.byPeer.get(peer).computerId);
      assert(split.deltas.has(holder), 'Journal entry account did not participate in settled request');
      return { split, delta: split.deltas.get(holder), attribution: null };
    }
    const split = accountSettlement(request, totalUnits, placeOf);
    assert(split.deltas.has(holder), 'Journal entry account did not participate in settled request');
    return { split, delta: split.deltas.get(holder),
      attribution: split.entries.filter(row => row.accountId === holder).map(row => ({ computerId: row.computerId, delta: row.delta })) };
  };

  const expiredRequests = new Set(), expiredWorkIds = new Set(), expiredById = new Map();
  const seenRequests = new Set(), seenWorkIds = new Set();
  const expiredVerified = [], verified = [], unchecked = [];
  let previousSequence = 0, recomputedBalance = 0;

  for (const item of statement.expired ?? []) {
    const requestId = typeof item?.requestId === 'string' ? item.requestId : null;
    try {
      assert(text(requestId) && !expiredRequests.has(requestId), 'Duplicate or invalid expired request ID');
      verifyRequestBinding(item.request, requestId, enrollment, policy);
      const participates = holdUnit(item.request) === holder
        || item.request.providers.some(provider => unitOfPeer(provider.participantId) === holder);
      assert(participates, 'Statement account did not participate in expired request');
      const window = releaseWindowFor(item.request, policy);
      assert(Number.isSafeInteger(window) && window > 0, 'Expired unclaimed hold requires an explicit policy release window');
      const outcome = item.outcome;
      assert(outcome && outcome.id === requestId && outcome.status === 'expired'
        && outcome.charge === 0 && outcome.ownComputeUnits === 0 && outcome.outputTokens === 0
        && Array.isArray(outcome.credits) && outcome.credits.length === 0
        && Number.isSafeInteger(outcome.settledAt)
        && outcome.settledAt >= item.request.deadline + window
        && outcome.settledAt <= statement.issuedAt + policy.maxClockSkewMs,
      'Invalid expired hold outcome');
      expiredRequests.add(requestId);
      expiredById.set(requestId, item.request);
      for (const workId of requestWorkIds(item.request)) expiredWorkIds.add(workId);
      expiredVerified.push({ requestId, mode: item.request.mode, expiredAt: outcome.settledAt, charge: 0 });
    } catch (error) {
      unchecked.push({ sequence: null, requestId, statedDelta: 0, recomputedDelta: null, reason: error.message });
    }
  }

  for (const entry of statement.entries) {
    const sequence = Number.isSafeInteger(entry?.sequence) ? entry.sequence : null;
    const requestId = typeof entry?.requestId === 'string' ? entry.requestId : null;
    const statedDelta = Number.isSafeInteger(entry?.delta) ? entry.delta : null;
    let recomputedDelta = null;
    try {
      assert(sequence !== null && sequence > previousSequence, 'Non-monotonic or invalid journal sequence');
      previousSequence = sequence;
      assert(text(requestId) && !seenRequests.has(requestId), 'Duplicate or invalid request ID');
      assert(!expiredRequests.has(requestId), 'Claim window closed; expired hold cannot reopen settlement');
      assert(statedDelta !== null && Number.isSafeInteger(entry.at), 'Explicit integer journal delta and timestamp required');
      verifyRequestBinding(entry.request, requestId, enrollment, policy);
      const window = releaseWindowFor(entry.request, policy);
      assert(entry.at >= entry.request.createdAt - policy.maxClockSkewMs
        && entry.at <= statement.issuedAt + policy.maxClockSkewMs, 'Journal timestamp is outside request or statement bounds');
      if (Number.isSafeInteger(window)) {
        assert(entry.at < entry.request.deadline + window, 'Claim window closed before settlement');
      }
      assert(entry.evidence !== null && entry.evidence !== undefined, 'Missing signed settlement evidence');
      const interrupted = await verifyInterruptedOwners(entry.request, entry.evidence, enrollment, entry.at, policy.maxClockSkewMs);
      const observed = await verifyCreditEvidence(entry.request, entry.evidence, enrollment, entry.at, policy.maxClockSkewMs, { interrupted });
      assert(!observed.terminalStatus || integer(observed.fixedCharge), 'Accepted fixed terminal terms required');
      for (const workId of observed.workIds) {
        assert(!expiredWorkIds.has(workId), 'Claim window closed; expired hold cannot reopen settlement');
        assert(!seenWorkIds.has(workId), 'Duplicate settled work evidence');
      }
      const totalUnits = settledCreditUnits(entry.request, observed, policy.creditsPerOutputToken);
      const { split, delta, attribution } = shareOf(entry.request, totalUnits);
      recomputedDelta = delta;
      if (attribution) {
        const stated = Array.isArray(entry.attribution) ? entry.attribution.map(row => ({ computerId: row?.computerId, delta: row?.delta })) : null;
        const order = rows => [...rows].sort((a, b) => (a.computerId < b.computerId ? -1 : a.computerId > b.computerId ? 1 : 0));
        assert(stated && same(order(stated), order(attribution)), 'Stated per-computer attribution differs from recomputed shares');
      }
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
        ...(attribution ? { attribution } : {}),
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

  let lateClaimResults;
  if (lateClaims !== undefined) {
    assert(Array.isArray(lateClaims), 'Late claims list must be an array');
    lateClaimResults = [];
    for (const claim of lateClaims) {
      const requestId = typeof claim?.requestId === 'string' ? claim.requestId : null;
      const at = Number.isSafeInteger(claim?.at) ? claim.at : statement.issuedAt;
      try {
        assert(text(requestId), 'Late claim requestId required');
        assert(!expiredRequests.has(requestId), 'Claim window closed; expired hold cannot reopen settlement');
        assert(!seenRequests.has(requestId), 'Request already settled');
        const request = claim.request ?? expiredById.get(requestId);
        assert(request, 'Late claim request binding required');
        verifyRequestBinding(request, requestId, enrollment, policy);
        const window = releaseWindowFor(request, policy);
        if (Number.isSafeInteger(window)) {
          assert(at < request.deadline + window, 'Claim window closed before settlement');
        }
        assert(claim.evidence !== null && claim.evidence !== undefined, 'Missing signed settlement evidence');
        const interrupted = await verifyInterruptedOwners(request, claim.evidence, enrollment, at, policy.maxClockSkewMs);
        const observed = await verifyCreditEvidence(request, claim.evidence, enrollment, at, policy.maxClockSkewMs, { interrupted });
        for (const workId of observed.workIds) {
          assert(!expiredWorkIds.has(workId), 'Claim window closed; expired hold cannot reopen settlement');
          assert(!seenWorkIds.has(workId), 'Duplicate settled work evidence');
        }
        lateClaimResults.push({ requestId, reopenAllowed: true, reason: null });
      } catch (error) {
        lateClaimResults.push({ requestId, reopenAllowed: false, reason: error.message });
      }
    }
  }

  const balanceMatches = recomputedBalance === statement.balance;
  const lateClaimsBlocked = lateClaimResults ? lateClaimResults.every(row => row.reopenAllowed === false) : true;
  return {
    ok: unchecked.length === 0 && balanceMatches && lateClaimsBlocked,
    ...(perAccount ? { accountId: holder, computerIds: owned.map(computer => computer.id) } : { computerId: holder }),
    unit: policy.unit,
    statedBalance: statement.balance,
    recomputedBalance,
    balanceMatches,
    held: statement.held,
    entryCount: statement.entries.length,
    verifiedCount: verified.length,
    expiredCount: expiredVerified.length,
    uncheckedCount: unchecked.length,
    verified,
    expired: expiredVerified,
    unchecked,
    ...(lateClaimResults ? { lateClaims: lateClaimResults } : {}),
  };
}

const entered = typeof import.meta.main === 'boolean' ? import.meta.main
  : (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();

if (entered) {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { 'late-claim': { type: 'string', multiple: true } },
  });
  const [statementFile, enrollmentFile] = positionals;
  assert(statementFile && path.isAbsolute(statementFile),
    'Usage: node server/fleet/credit-statement.js /absolute/statement.json [/absolute/enrollment.json] [--late-claim /absolute/late-claim.json]');
  const statement = JSON.parse(await fs.readFile(statementFile, 'utf8'));
  const computers = enrollmentFile ? JSON.parse(await fs.readFile(path.resolve(enrollmentFile), 'utf8')) : undefined;
  let lateClaims;
  if (values['late-claim']?.length) {
    lateClaims = [];
    for (const claimFile of values['late-claim']) {
      assert(path.isAbsolute(claimFile), 'Absolute --late-claim path required');
      const parsed = JSON.parse(await fs.readFile(claimFile, 'utf8'));
      lateClaims.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    }
  }
  const result = await verifyCreditStatement(statement, {
    ...(computers ? { computers } : {}),
    ...(lateClaims ? { lateClaims } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
