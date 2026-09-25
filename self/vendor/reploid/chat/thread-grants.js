/** Conversation disclosure only. The host supplies the verified recipient identity. */
const hash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const recipient = value => typeof value === 'string' && /^peer:[a-f0-9]{24}$/.test(value);

export function disclosureScope(request, preview) {
  const adapters = (request.model.adapters || []).map(adapter => adapter.identity);
  if (preview.operation !== 'generate' || preview.disclosure !== 'public'
    || typeof request.permissions.sharingScope !== 'string' || request.permissions.sharingScope === 'local'
    || !recipient(preview.recipientIdentity) || !hash(preview.modelIdentity)
    || preview.modelId !== request.model.id || preview.modelIdentity !== request.model.identity
    || JSON.stringify(preview.adapterIdentities) !== JSON.stringify(adapters)) return null;
  return { recipientIdentity: preview.recipientIdentity, modelId: request.model.id,
    modelIdentity: request.model.identity, adapterIdentities: adapters,
    sharingScope: request.permissions.sharingScope, disclosure: 'public' };
}

export function matchingThreadGrant(grants, scope) {
  return scope && grants.find(grant => grant.revokedAt === null
    && ['recipientIdentity', 'modelId', 'modelIdentity', 'sharingScope', 'disclosure'].every(key => grant[key] === scope[key])
    && JSON.stringify(grant.adapterIdentities) === JSON.stringify(scope.adapterIdentities));
}

export function validateThreadGrants(grants, threadId, meshId, limit) {
  if (!Array.isArray(grants) || grants.length > limit || new Set(grants.map(grant => grant?.id)).size !== grants.length
    || grants.some(grant => !grant || typeof grant.id !== 'string' || !grant.id || grant.threadId !== threadId
      || grant.meshId !== meshId || !recipient(grant.recipientIdentity) || typeof grant.modelId !== 'string'
      || !hash(grant.modelIdentity) || !Array.isArray(grant.adapterIdentities) || !grant.adapterIdentities.every(hash)
      || typeof grant.sharingScope !== 'string' || grant.disclosure !== 'public'
      || !Number.isFinite(grant.createdAt) || grant.revokedAt !== null && !Number.isFinite(grant.revokedAt))) {
    throw new Error('Invalid stored conversation grants');
  }
}
