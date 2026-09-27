import { createPeerIdFromPublicJwk, importSigningKey, importVerificationKey, getIdentitySignAlgorithm,
  toBase64Url, fromBase64Url } from '../../artifacts/identity.js';
import { assertPartition as assert, canonicalPartitionJson, validatePartitionIdentity,
  samePartitionIdentity, partitionActions } from './partition-contract.js';

const SCHEMA = 'reploid.partition-grant/v2';
const bytes = value => new TextEncoder().encode(canonicalPartitionJson(value));
const bounds = ['maxTokens', 'maxPromptTokens', 'maxActivationBytes', 'maxOutputCharacters'];

/** The host calls issue only after disclosure approval. B separately consents by preparing its resident. */
export function createPartitionGrantAuthority({ identity, meshId, maxGrants, maxTtlMs, now = Date.now }) {
  assert(identity?.privateJwk && identity?.publicJwk && typeof meshId === 'string' && meshId
    && Number.isSafeInteger(maxGrants) && maxGrants > 0 && Number.isSafeInteger(maxTtlMs) && maxTtlMs > 0,
  'Explicit partition signing identity, mesh and grant budgets required');
  const signer = structuredClone(identity);
  const issued = new Map();
  let closed = false;
  async function verify(grant, request, { settlement = false } = {}) {
    try {
      if (closed) return false;
      validatePartitionIdentity(request.identity);
      const record = structuredClone(grant), claim = record.claim;
      if (claim?.schema !== SCHEMA || claim.meshId !== meshId || !samePartitionIdentity(claim.identity, request.identity)
        || !['partition-activations', 'partition-activations-and-tokens'].includes(claim.disclosure)
        || !/^sha256:[a-f0-9]{64}$/.test(claim.generationDigest)
        || !Number.isSafeInteger(claim.issuedAt) || !Number.isSafeInteger(claim.expiresAt)
        || claim.issuedAt > now() || claim.expiresAt <= claim.issuedAt || claim.expiresAt - claim.issuedAt > maxTtlMs
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
