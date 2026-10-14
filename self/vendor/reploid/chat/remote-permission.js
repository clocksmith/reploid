/** One standing permission to send conversations to remote contributors. The host stores and revokes it;
 * the workspace consults it before every remote disclosure and cites it in each attempt's authorization. */
export const REMOTE_PERMISSION_SCHEMA = 'reploid.remote-permission/v1';
export const REMOTE_DISCLOSURES = Object.freeze(['public', 'partition-activations-and-tokens', 'ordered-partition-activations-and-tokens']);

const hash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const unique = values => [...new Set(values)].sort();

/** The disclosure a selected model would make if it runs remotely. Local execution makes none. */
export function remoteDisclosureKind(model) {
  if (model?.partition?.schema === 'reploid.partition-selection/v2') return 'ordered-partition-activations-and-tokens';
  return model?.partition ? 'partition-activations-and-tokens' : 'public';
}

/** What one remote request needs from a permission: its sharing scope, disclosure kind and exact model identity. */
export function remotePermissionNeed({ sharingScope, disclosure, model }) {
  return { sharingScope, disclosure, modelId: model.id, modelIdentity: model.identity,
    adapterIdentities: unique((model.adapters || []).map(adapter => adapter.identity)) };
}

/** A request is inside a permission exactly when the permission is unrevoked and has the same sharing scope,
 * the same disclosure kind, lists the request's model identity, and lists every adapter identity it applies.
 * Anything else is outside: no permission, a revoked one, or a different scope, kind, model or adapter. */
export function remotePermissionCovers(permission, need) {
  return permission?.schema === REMOTE_PERMISSION_SCHEMA && permission.revokedAt === null
    && typeof need?.sharingScope === 'string' && need.sharingScope !== 'local' && permission.sharingScope === need.sharingScope
    && permission.disclosure === need.disclosure && permission.modelIdentities.includes(need.modelIdentity)
    && need.adapterIdentities.every(identity => permission.adapterIdentities.includes(identity));
}

/** A new permission for `need`, extended to the verified catalog the person chose models from. */
export function createRemotePermission({ id, need, catalog = [], grantedAt }) {
  return validateRemotePermission({ schema: REMOTE_PERMISSION_SCHEMA, id, sharingScope: need.sharingScope, disclosure: need.disclosure,
    modelIdentities: unique([need.modelIdentity, ...catalog.map(model => model.identity)]),
    adapterIdentities: unique([...need.adapterIdentities, ...catalog.flatMap(model => (model.availableAdapters || []).map(adapter => adapter.identity))]),
    grantedAt, revokedAt: null });
}

export function validateRemotePermission(permission) {
  const keys = ['schema', 'id', 'sharingScope', 'disclosure', 'modelIdentities', 'adapterIdentities', 'grantedAt', 'revokedAt'];
  if (!permission || typeof permission !== 'object' || Object.keys(permission).length !== keys.length || !keys.every(key => Object.hasOwn(permission, key))
    || permission.schema !== REMOTE_PERMISSION_SCHEMA || typeof permission.id !== 'string' || !permission.id
    || typeof permission.sharingScope !== 'string' || !permission.sharingScope || permission.sharingScope === 'local'
    || !REMOTE_DISCLOSURES.includes(permission.disclosure)
    || !Array.isArray(permission.modelIdentities) || !permission.modelIdentities.length || !permission.modelIdentities.every(hash)
    || !Array.isArray(permission.adapterIdentities) || !permission.adapterIdentities.every(hash)
    || !Number.isFinite(permission.grantedAt) || permission.revokedAt !== null && !Number.isFinite(permission.revokedAt)) {
    throw new Error('Invalid remote contributor permission');
  }
  return structuredClone(permission);
}
