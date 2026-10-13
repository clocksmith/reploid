import { createPeerIdFromPublicJwk, importSigningKey, importVerificationKey, getIdentitySignAlgorithm,
  toBase64Url, fromBase64Url } from '../../artifacts/identity.js';
import { assertPartition as assert, canonicalPartitionJson, validatePartitionIdentity,
  samePartitionIdentity, partitionActions, partitionIdentityKeys } from './partition-contract.js';

const SCHEMA = 'reploid.partition-grant/v2';
const CANONICAL_SCHEMA = 'reploid.partition-grant/v3';
const bytes = value => new TextEncoder().encode(canonicalPartitionJson(value));
const bounds = ['maxTokens', 'maxPromptTokens', 'maxActivationBytes', 'maxOutputCharacters'];

/** The host calls issue only after disclosure approval. B separately consents by preparing its resident. */
export function createPartitionGrantAuthority({ identity, meshId, maxGrants, maxTtlMs, maxClockSkewMs = 0, now = Date.now, canonicalRuntime }) {
  assert(identity?.privateJwk && identity?.publicJwk && typeof meshId === 'string' && meshId
    && Number.isSafeInteger(maxGrants) && maxGrants > 0 && Number.isSafeInteger(maxTtlMs) && maxTtlMs > 0
    && Number.isSafeInteger(maxClockSkewMs) && maxClockSkewMs >= 0,
  'Explicit partition signing identity, mesh and grant budgets required');
  const signer = structuredClone(identity);
  const issued = new Map();
  let closed = false;
  const canonicalCapability = () => assert(['metadataDigest', 'canonicalGenerationIdentity', 'validateResidentAttemptIdentity', 'residentAttemptDigest']
    .every(method => typeof canonicalRuntime?.[method] === 'function'), 'Canonical Doppler grant capability required');
  const exact = (value, keys) => assert(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), 'Invalid canonical grant fields');
  const canonicalDigest = value => canonicalRuntime.metadataDigest(CANONICAL_SCHEMA, value);
  const canonicalBytes = value => new TextEncoder().encode(canonicalDigest(value));
  const canonicalScope = ({ identity: binding, limits, disclosure, generationId }) => {
    canonicalCapability(); validatePartitionIdentity(binding);
    exact(binding, [...partitionIdentityKeys, 'requesterId', 'placementGeneration']);
    assert(typeof binding.requesterId === 'string' && bounds.every(key => Number.isSafeInteger(limits?.[key]) && limits[key] > 0)
      && disclosure === 'partition-activations-and-tokens' && /^sha256:[a-f0-9]{64}$/.test(generationId),
    'Explicit canonical route, disclosure and allocation required');
    return canonicalRuntime.metadataDigest('reploid.partition-authorization/v1', { meshId, identity: binding,
      limits: Object.fromEntries(bounds.map(key => [key, limits[key]])), disclosure, generationId });
  };
  const canonicalClaim = claim => {
    canonicalCapability();
    canonicalDigest(claim);
    exact(claim, ['schema', 'id', 'meshId', 'identity', 'canonicalAttempt', 'generation', 'vocabSize',
      'disclosure', 'issuedAt', 'expiresAt', 'limits']);
    exact(claim.limits, bounds); exact(claim.generation, ['policy', 'executionIdentity', 'generationId']);
    assert(claim.schema === CANONICAL_SCHEMA && claim.meshId === meshId, 'Canonical grant scope mismatch');
    const generation = canonicalRuntime.canonicalGenerationIdentity(claim.generation.policy,
      claim.generation.executionIdentity, claim.vocabSize);
    assert(canonicalDigest(generation) === canonicalDigest(claim.generation), 'Canonical generation identity mismatch');
    const attempt = canonicalRuntime.validateResidentAttemptIdentity(claim.canonicalAttempt);
    assert(attempt.attemptId === claim.identity.attemptId && attempt.requesterId === claim.identity.requesterId
      && attempt.generationId === generation.generationId && attempt.routeKind === 'two-stage-layer'
      && attempt.stages[0].participantId === claim.identity.participantA
      && attempt.stages[1].participantId === claim.identity.participantB
      && attempt.stages.every(stage => stage.executionId === generation.executionIdentity), 'Canonical attempt route binding mismatch');
    assert(attempt.authorizationScope === canonicalScope({ ...claim, generationId: generation.generationId }),
      'Canonical authorization scope mismatch');
    assert(generation.policy.maxGeneratedTokens <= claim.limits.maxTokens
      && generation.policy.maxRawOutputUtf16 <= claim.limits.maxOutputCharacters
      && generation.policy.maxVisibleOutputUtf16 <= claim.limits.maxOutputCharacters,
    'Canonical generation exceeds grant allocation');
    assert(typeof claim.id === 'string' && claim.id.length > 0 && claim.id.length <= 128
      && Number.isSafeInteger(claim.issuedAt) && claim.issuedAt >= 0 && Number.isSafeInteger(claim.expiresAt)
      && claim.issuedAt <= now() + maxClockSkewMs && claim.expiresAt > claim.issuedAt
      && claim.expiresAt - claim.issuedAt <= maxTtlMs, 'Invalid canonical grant lifetime');
    return { generation, attempt };
  };
  async function verifyCanonical(grant, request, settlement) {
    try {
      if (closed) return false;
      canonicalCapability(); canonicalDigest({ grant, request });
      const record = structuredClone(grant), input = structuredClone(request), claim = record.claim;
      exact(record, ['claim', 'publicJwk', 'signature']);
      const { generation, attempt } = canonicalClaim(claim);
      const requested = canonicalRuntime.validateResidentAttemptIdentity(input.canonicalAttempt);
      if (!samePartitionIdentity(claim.identity, input.identity)
        || canonicalRuntime.residentAttemptDigest(attempt) !== canonicalRuntime.residentAttemptDigest(requested)) return false;
      if (!settlement) {
        if (claim.expiresAt <= now() || issued.get(claim.id)?.revoked === true
          || input.generationId !== generation.generationId || !partitionActions.includes(input.action)
          || !['admit', 'step'].includes(input.phase) || !Number.isSafeInteger(input.step) || input.step < 0
          || !Number.isSafeInteger(input.inputTokenCount) || input.inputTokenCount < 1
          || input.inputTokenCount > (input.step === 0 ? Math.min(claim.limits.maxPromptTokens,
            generation.policy.materializedInputCapacity, generation.policy.totalAcceptedTokenLimit) : 1)
          || input.phase === 'admit' && (input.step !== 0 || input.activationBytes != null && input.activationBytes !== 0)
          || input.phase === 'step' && input.step >= generation.policy.maxGeneratedTokens
          || input.activationBytes != null && (!Number.isSafeInteger(input.activationBytes)
            || input.activationBytes < 0 || input.activationBytes > claim.limits.maxActivationBytes)) return false;
      }
      if (await createPeerIdFromPublicJwk(record.publicJwk) !== claim.identity.participantA) return false;
      const key = await importVerificationKey(record.publicJwk);
      const valid = await crypto.subtle.verify(getIdentitySignAlgorithm(record.publicJwk), key,
        fromBase64Url(record.signature), canonicalBytes(claim));
      return valid && !closed && (settlement || claim.expiresAt > now() && issued.get(claim.id)?.revoked !== true);
    } catch { return false; }
  }
  async function verify(grant, request, { settlement = false } = {}) {
    if (grant?.claim?.schema === CANONICAL_SCHEMA) return verifyCanonical(grant, request, settlement);
    try {
      if (closed) return false;
      validatePartitionIdentity(request.identity);
      const record = structuredClone(grant), claim = record.claim;
      if (claim?.schema !== SCHEMA || claim.meshId !== meshId || !samePartitionIdentity(claim.identity, request.identity)
        || !['partition-activations', 'partition-activations-and-tokens'].includes(claim.disclosure)
        || !/^sha256:[a-f0-9]{64}$/.test(claim.generationDigest)
        || !Number.isSafeInteger(claim.issuedAt) || !Number.isSafeInteger(claim.expiresAt)
        || claim.issuedAt > now() + maxClockSkewMs || claim.expiresAt <= claim.issuedAt || claim.expiresAt - claim.issuedAt > maxTtlMs
        || typeof claim.id !== 'string' || claim.id.length > 128
        || bounds.some(key => !Number.isSafeInteger(claim.limits?.[key]) || claim.limits[key] <= 0)) return false;
      if (!settlement && (claim.expiresAt <= now() || issued.get(claim.id)?.revoked === true
        || !partitionActions.includes(request.action) || !Number.isSafeInteger(request.step)
        || request.generationDigest !== claim.generationDigest
        || request.action === 'mesh.transfer_token_context' && claim.disclosure !== 'partition-activations-and-tokens'
        || request.step < 0 || request.step >= claim.limits.maxTokens
        || !Number.isSafeInteger(request.inputTokenCount) || request.inputTokenCount < 1
        || request.inputTokenCount > (request.step === 0 ? claim.limits.maxPromptTokens : 1)
        || request.activationBytes != null && (!Number.isSafeInteger(request.activationBytes)
          || request.activationBytes < 0 || request.activationBytes > claim.limits.maxActivationBytes))) return false;
      if (await createPeerIdFromPublicJwk(record.publicJwk) !== request.identity.participantA) return false;
      const key = await importVerificationKey(record.publicJwk);
      const valid = await crypto.subtle.verify(getIdentitySignAlgorithm(record.publicJwk), key,
        fromBase64Url(record.signature), bytes(claim));
      return valid && !closed && (settlement || claim.expiresAt > now() && issued.get(claim.id)?.revoked !== true);
    } catch { return false; }
  }
  return Object.freeze({
    participantId: signer.peerId, meshId, verify,
    canonicalScope,
    async issueCanonical(binding, limits, { approved, ttlMs, disclosure, generation, canonicalAttempt, vocabSize }) {
      canonicalCapability();
      assert(!closed && approved === true, 'Explicit canonical partition disclosure approval required');
      assert(Number.isSafeInteger(ttlMs) && ttlMs > 0 && ttlMs <= maxTtlMs, 'Invalid canonical grant lifetime');
      const issuedAt = now();
      const claim = structuredClone({ schema: CANONICAL_SCHEMA, id: crypto.randomUUID(), meshId, identity: binding,
        canonicalAttempt, generation, vocabSize, disclosure, issuedAt, expiresAt: issuedAt + ttlMs,
        limits: Object.fromEntries(bounds.map(key => [key, limits[key]])) });
      canonicalClaim(claim);
      assert(claim.identity.participantA === signer.peerId && await createPeerIdFromPublicJwk(signer.publicJwk) === signer.peerId,
        'Only the authenticated input owner grants canonical execution');
      assert(!closed && issued.size < maxGrants, 'Partition grant budget exhausted');
      const entry = { revoked: false }; issued.set(claim.id, entry);
      try {
        const key = await importSigningKey(signer);
        const signature = await crypto.subtle.sign(getIdentitySignAlgorithm(signer), key, canonicalBytes(claim));
        assert(!closed && !entry.revoked, 'Partition authority closed');
        return { claim, publicJwk: structuredClone(signer.publicJwk), signature: toBase64Url(signature) };
      } catch (error) { entry.revoked = true; throw error; }
    },
    async issue(binding, limits, { approved, ttlMs, disclosure, generationDigest }) {
      binding = structuredClone(binding); limits = structuredClone(limits);
      assert(!closed && approved === true, 'Explicit partition disclosure approval required');
      validatePartitionIdentity(binding);
      assert(binding.participantA === signer.peerId && await createPeerIdFromPublicJwk(signer.publicJwk) === signer.peerId,
        'Only the authenticated input owner can grant partition execution');
      assert(Number.isSafeInteger(ttlMs) && ttlMs > 0 && ttlMs <= maxTtlMs, 'Invalid partition grant lifetime');
      assert(['partition-activations', 'partition-activations-and-tokens'].includes(disclosure)
        && /^sha256:[a-f0-9]{64}$/.test(generationDigest), 'Explicit partition disclosure and generation identity required');
      assert(bounds.every(key => Number.isSafeInteger(limits?.[key]) && limits[key] > 0), 'Explicit partition grant allocations required');
      assert(issued.size < maxGrants, 'Partition grant budget exhausted');
      const issuedAt = now();
      const claim = { schema: SCHEMA, id: crypto.randomUUID(), meshId, identity: binding,
        disclosure, generationDigest, issuedAt, expiresAt: issuedAt + ttlMs,
        limits: Object.fromEntries(bounds.map(key => [key, limits[key]])) };
      const entry = { revoked: false }; issued.set(claim.id, entry);
      try {
        const key = await importSigningKey(signer);
        const signature = await crypto.subtle.sign(getIdentitySignAlgorithm(signer), key, bytes(claim));
        assert(!closed && !entry.revoked, 'Partition authority closed');
        return { claim, publicJwk: structuredClone(signer.publicJwk), signature: toBase64Url(signature) };
      } catch (error) { entry.revoked = true; throw error; }
    },
    revoke(grant) { const entry = issued.get(grant?.claim?.id); if (entry) entry.revoked = true; },
    close() { closed = true; for (const entry of issued.values()) entry.revoked = true; }
  });
}
