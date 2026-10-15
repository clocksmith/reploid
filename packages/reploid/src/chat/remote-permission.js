/** Permission records. A remote-contributors record is the one standing permission to send conversations to
 * remote contributors: the host stores and revokes it, and the workspace consults it before every remote disclosure
 * and cites it in each attempt's authorization. A search-answer record (search-permission.js) allows one
 * search-backed answer. Every v3 record keeps the exact wording the person was shown when granting it. */
export const REMOTE_PERMISSION_SCHEMA = 'reploid.remote-permission/v3';
export const PERMISSION_KINDS = Object.freeze(['remote-contributors', 'search-answer']);
export const REMOTE_DISCLOSURES = Object.freeze(['public', 'partition-activations-and-tokens', 'ordered-partition-activations-and-tokens']);

const hash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const unique = values => [...new Set(values)].sort();
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

/** The wording shown when a permission was granted: its id, version and exact text. */
export function validPermissionWording(wording) {
  return !!wording && typeof wording === 'object' && Object.keys(wording).length === 3 && label(wording.id) && label(wording.version)
    && typeof wording.text === 'string' && wording.text.trim().length > 0 && wording.text.length <= 4000;
}

/** The disclosure a selected model would make if it runs remotely. Local execution makes none. */
export function remoteDisclosureKind(model) {
  if (model?.partition?.schema === 'reploid.partition-selection/v2') return 'ordered-partition-activations-and-tokens';
  return model?.partition ? 'partition-activations-and-tokens' : 'public';
}

const network = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

/** What one remote request needs from a permission: the network it is sent on, its sharing scope,
 * disclosure kind and exact model identity. */
export function remotePermissionNeed({ networkId, sharingScope, disclosure, model }) {
  if (!network(networkId)) throw new Error('Remote permission requires the network the request is sent on');
  return { networkId, sharingScope, disclosure, modelId: model.id, modelIdentity: model.identity,
    adapterIdentities: unique((model.adapters || []).map(adapter => adapter.identity)) };
}

/** A request is inside a permission exactly when the permission is an unrevoked remote-contributors record granted
 * on the same network, with the same sharing scope and disclosure kind, listing the request's model identity and
 * every adapter identity it applies. Anything else is outside: no permission, a revoked one, an earlier schema whose
 * wording was not recorded, another network, or a different scope, kind, model or adapter. */
export function remotePermissionCovers(permission, need) {
  return permission?.schema === REMOTE_PERMISSION_SCHEMA && permission.kind === 'remote-contributors' && permission.revokedAt === null
    && network(need?.networkId) && permission.networkId === need.networkId
    && typeof need?.sharingScope === 'string' && need.sharingScope !== 'local' && permission.sharingScope === need.sharingScope
    && permission.disclosure === need.disclosure && permission.modelIdentities.includes(need.modelIdentity)
    && need.adapterIdentities.every(identity => permission.adapterIdentities.includes(identity));
}

/** A new permission for `need`, extended to the verified catalog the person chose models from, recording `wording`. */
export function createRemotePermission({ id, need, catalog = [], wording, grantedAt }) {
  return validateRemotePermission({ schema: REMOTE_PERMISSION_SCHEMA, kind: 'remote-contributors', id, networkId: need.networkId,
    sharingScope: need.sharingScope, disclosure: need.disclosure,
    modelIdentities: unique([need.modelIdentity, ...catalog.map(model => model.identity)]),
    adapterIdentities: unique([...need.adapterIdentities, ...catalog.flatMap(model => (model.availableAdapters || []).map(adapter => adapter.identity))]),
    wording: wording && { id: wording.id, version: wording.version, text: wording.text }, grantedAt, revokedAt: null });
}

export function validateRemotePermission(permission) {
  const keys = ['schema', 'kind', 'id', 'networkId', 'sharingScope', 'disclosure', 'modelIdentities', 'adapterIdentities', 'wording', 'grantedAt', 'revokedAt'];
  if (!permission || typeof permission !== 'object' || Object.keys(permission).length !== keys.length || !keys.every(key => Object.hasOwn(permission, key))
    || permission.schema !== REMOTE_PERMISSION_SCHEMA || permission.kind !== 'remote-contributors'
    || typeof permission.id !== 'string' || !permission.id || !network(permission.networkId)
    || typeof permission.sharingScope !== 'string' || !permission.sharingScope || permission.sharingScope === 'local'
    || !REMOTE_DISCLOSURES.includes(permission.disclosure)
    || !Array.isArray(permission.modelIdentities) || !permission.modelIdentities.length || !permission.modelIdentities.every(hash)
    || !Array.isArray(permission.adapterIdentities) || !permission.adapterIdentities.every(hash) || !validPermissionWording(permission.wording)
    || !Number.isFinite(permission.grantedAt) || permission.revokedAt !== null && !Number.isFinite(permission.revokedAt)) {
    throw new Error('Invalid remote contributor permission');
  }
  return structuredClone(permission);
}
