import { canonicalPartitionRoute, canonicalPartitionJson } from '../mesh/partitions/partition-contract.js';
import { orderedPartitionDisclosure } from '../mesh/partitions/partition-grants.js';

/** Conversation disclosure only. The host supplies the verified recipient identity. */
const hash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const recipient = value => typeof value === 'string' && /^peer:[a-f0-9]{24}$/.test(value);

const orderedDisclosure = 'ordered-partition-activations-and-tokens';
const sameJson = (a, b) => canonicalPartitionJson(a ?? null) === canonicalPartitionJson(b ?? null);

function orderedScope(request, preview, requesterIdentity) {
  try {
    const route = canonicalPartitionRoute(preview.route), coordinator = route.stages[0].participantId;
    if (!recipient(requesterIdentity) || !route.stages.every(stage => recipient(stage.participantId))
      || preview.schema !== 'reploid.partition-selection/v2' || preview.operation !== 'generate-partition'
      || route.modelId !== request.model.id || route.modelIdentity !== request.model.identity
      || route.planId !== request.model.partition.planId || preview.planId !== route.planId
      || preview.coordinatorId !== coordinator || preview.peerId !== coordinator || preview.recipientIdentity !== coordinator) return null;
    const disclosure = orderedPartitionDisclosure({ schema: 'reploid.partition-attempt/v2', route,
      requesterId: requesterIdentity, threadId: preview.threadId, attemptId: preview.attemptId, placementGeneration: 0 });
    const recipients = [...new Set([...disclosure.tokenRecipients, ...disclosure.outputRecipients])];
    if (!sameJson(preview.disclosure, disclosure) || !sameJson(preview.input?.recipients, recipients)) return null;
    return { recipientIdentity: coordinator, disclosure: orderedDisclosure, planId: route.planId,
      route, requesterIdentity };
  } catch { return null; }
}

export function disclosureScope(request, preview, requesterIdentity) {
  const adapters = (request.model.adapters || []).map(adapter => adapter.identity);
  if (request.model.partition?.schema === 'reploid.partition-selection/v2') {
    const ordered = orderedScope(request, preview, requesterIdentity);
    if (!ordered || typeof request.permissions.sharingScope !== 'string' || request.permissions.sharingScope === 'local'
      || preview.modelId !== request.model.id || preview.modelIdentity !== request.model.identity
      || !sameJson(preview.adapterIdentities, adapters)) return null;
    return { ...ordered, modelId: request.model.id, modelIdentity: request.model.identity,
      adapterIdentities: adapters, sharingScope: request.permissions.sharingScope };
  }
  const partition = preview.operation === 'generate-partition' && preview.disclosure === 'partition-activations-and-tokens'
    && typeof preview.planId === 'string' && preview.planId === request.model.partition?.planId
    && recipient(preview.participantA) && recipient(preview.participantB) && preview.participantA !== preview.participantB
    && (preview.recipientIdentity === preview.participantA && preview.peerId === preview.participantA
      && JSON.stringify(preview.input?.recipients) === JSON.stringify([preview.participantA, preview.participantB])
      || preview.participantA === request.model.partition?.participantA
        && preview.participantB === request.model.partition?.participantB && preview.recipientIdentity === preview.participantB);
  if (!(preview.operation === 'generate' && preview.disclosure === 'public' || partition)
    || typeof request.permissions.sharingScope !== 'string' || request.permissions.sharingScope === 'local'
    || !recipient(preview.recipientIdentity) || !hash(preview.modelIdentity)
    || preview.modelId !== request.model.id || preview.modelIdentity !== request.model.identity
    || JSON.stringify(preview.adapterIdentities) !== JSON.stringify(adapters)) return null;
  // The persisted pair is input participantA plus output recipientIdentity.
  // Entry-host previews address the input owner; normalize without dropping the output binding.
  return { recipientIdentity: partition ? preview.participantB : preview.recipientIdentity, modelId: request.model.id,
    modelIdentity: request.model.identity, adapterIdentities: adapters,
    sharingScope: request.permissions.sharingScope, disclosure: preview.disclosure,
    ...(partition ? { planId: preview.planId, participantA: preview.participantA } : {}) };
}

export function matchingThreadGrant(grants, scope) {
  return scope && grants.find(grant => grant.revokedAt === null
    && ['recipientIdentity', 'modelId', 'modelIdentity', 'sharingScope', 'disclosure'].every(key => grant[key] === scope[key])
    && JSON.stringify(grant.adapterIdentities) === JSON.stringify(scope.adapterIdentities)
    && grant.planId === scope.planId && grant.participantA === scope.participantA
    && grant.requesterIdentity === scope.requesterIdentity && sameJson(grant.route, scope.route));
}

function validOrderedGrant(grant, requesterIdentity) {
  try {
    const route = canonicalPartitionRoute(grant.route);
    return recipient(requesterIdentity) && grant.requesterIdentity === requesterIdentity
      && route.stages.every(stage => recipient(stage.participantId))
      && route.stages[0].participantId === grant.recipientIdentity
      && route.modelId === grant.modelId && route.modelIdentity === grant.modelIdentity
      && route.planId === grant.planId && grant.participantA === undefined;
  } catch { return false; }
}

export function validateThreadGrants(grants, threadId, meshId, limit, requesterIdentity) {
  if (!Array.isArray(grants) || grants.length > limit || new Set(grants.map(grant => grant?.id)).size !== grants.length
    || grants.some(grant => !grant || typeof grant.id !== 'string' || !grant.id || grant.threadId !== threadId
      || grant.meshId !== meshId || !recipient(grant.recipientIdentity) || typeof grant.modelId !== 'string'
      || !hash(grant.modelIdentity) || !Array.isArray(grant.adapterIdentities) || !grant.adapterIdentities.every(hash)
      || typeof grant.sharingScope !== 'string' || !['public', 'partition-activations', 'partition-activations-and-tokens', orderedDisclosure].includes(grant.disclosure)
      || (grant.disclosure === orderedDisclosure ? !validOrderedGrant(grant, requesterIdentity)
        : grant.route !== undefined || grant.requesterIdentity !== undefined
          || grant.disclosure !== 'public' && (typeof grant.planId !== 'string' || !grant.planId || !recipient(grant.participantA)))
      || !Number.isFinite(grant.createdAt) || grant.revokedAt !== null && !Number.isFinite(grant.revokedAt))) {
    throw new Error('Invalid stored conversation grants');
  }
}
