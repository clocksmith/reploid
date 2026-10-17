/** Per-answer permission for a search-backed answer. It allows exactly one answer in one conversation: sending its
 * query to the named search service and sharing the retrieved passages with the listed execution contributors,
 * and nothing else from the conversation. The record keeps the governing wording; source=send records host authorization from Send or Retry,
 * not a dialog interaction. Legacy records without source retain their dialog provenance. Only wording in
 * search-permission.json is accepted, so a search service without approved wording cannot be offered. */
import policy from './search-permission.json' with { type: 'json' };
import { REMOTE_PERMISSION_SCHEMA, validPermissionWording } from './remote-permission.js';

export const SEARCH_PERMISSION_KIND = 'search-answer';
export const SEARCH_RECIPIENTS_CHANGED = 'The contributors for this answer changed after search was allowed. Nothing was sent to them. Retry starts a new search.';
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

/** The approved wording for a search service, or null when none is approved. */
export function searchPermissionWording(searchProvider) {
  const wording = Object.hasOwn(policy.wordings, searchProvider) ? policy.wordings[searchProvider] : null;
  return wording ? { id: policy.id, version: wording.version, text: wording.text } : null;
}

const sameWording = (a, b) => !!a && !!b && a.id === b.id && a.version === b.version && a.text === b.text;

/** Search services whose query goes to a server the person chose; their permissions name that server's host. */
const PERSON_CHOSEN_SERVERS = new Set(policy.personChosenServer);

export function validateSearchPermission(input) {
  const keys = [...(Object.hasOwn(input || {}, 'source') ? ['source'] : []), 'schema', 'kind', 'id', 'networkId', 'threadId', 'searchProvider', 'searchServer', 'query', 'recipients', 'wording', 'grantedAt', 'revokedAt', ...(input?.searchProvider === 'contributor-bing' ? ['searchPeer'] : [])];
  // Records written before searchServer existed named only fixed services; they read as naming no server.
  const permission = input && typeof input === 'object' && !Object.hasOwn(input, 'searchServer') ? { ...input, searchServer: null } : input;
  const server = permission?.searchServer;
  if (!permission || typeof permission !== 'object' || Object.keys(permission).length !== keys.length || !keys.every(key => Object.hasOwn(permission, key))
    || (PERSON_CHOSEN_SERVERS.has(permission.searchProvider) ? !label(server) || !/^[a-z0-9.-]+(:\d{1,5})?$/i.test(server) : server !== null)
    || (permission.searchProvider === 'contributor-bing' && !label(permission.searchPeer))
    || (Object.hasOwn(permission, 'source') && !['send', 'dialog'].includes(permission.source))
    || permission.schema !== REMOTE_PERMISSION_SCHEMA || permission.kind !== SEARCH_PERMISSION_KIND
    || !label(permission.id) || !label(permission.networkId) || !label(permission.threadId) || !label(permission.searchProvider)
    || typeof permission.query !== 'string' || !permission.query.trim()
    || !Array.isArray(permission.recipients) || permission.recipients.length > policy.maxRecipients || !permission.recipients.every(label)
    || new Set(permission.recipients).size !== permission.recipients.length
    || !validPermissionWording(permission.wording) || !sameWording(permission.wording, searchPermissionWording(permission.searchProvider))
    || !Number.isFinite(permission.grantedAt) || permission.revokedAt !== null) {
    throw new Error('Invalid search permission');
  }
  return structuredClone(permission);
}

/** A grant for one answer. `wording` must match the governing policy; source distinguishes Send from dialog consent;
 * `recipients` are the execution contributors listed with it (empty when the answer runs on this device);
 * `searchServer` is the host of the person-chosen search server shown with it, null for fixed services. */
export function createSearchPermission({ id, networkId, threadId, searchProvider, searchServer = null, searchPeer = null, query, recipients, wording, source, grantedAt }) {
  if (!sameWording(wording, searchPermissionWording(searchProvider))) throw new Error('The shown search permission wording is not the approved text');
  return validateSearchPermission({ schema: REMOTE_PERMISSION_SCHEMA, kind: SEARCH_PERMISSION_KIND, id, networkId, threadId, searchProvider,
    ...(source ? { source } : {}), searchServer, ...(searchProvider === 'contributor-bing' ? { searchPeer } : {}), query, recipients: [...recipients], wording: { id: wording.id, version: wording.version, text: wording.text }, grantedAt, revokedAt: null });
}
