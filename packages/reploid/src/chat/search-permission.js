/** Per-answer permission for a search-backed answer. It allows exactly one answer in one conversation: sending its
 * query to the named search service and sharing the retrieved passages with the listed execution contributors,
 * and nothing else from the conversation. The record keeps the exact approved wording shown; only wording in
 * search-permission.json is accepted, so a search service without approved wording cannot be offered. */
import policy from './search-permission.json' with { type: 'json' };
import { REMOTE_PERMISSION_SCHEMA, validPermissionWording } from './remote-permission.js';

export const SEARCH_PERMISSION_KIND = 'search-answer';
export const SEARCH_RECIPIENTS_CHANGED = 'The contributors for this answer changed after search was allowed. Nothing was sent to them. Retry asks again.';
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

/** The approved wording for a search service, or null when none is approved. */
export function searchPermissionWording(searchProvider) {
  const wording = Object.hasOwn(policy.wordings, searchProvider) ? policy.wordings[searchProvider] : null;
  return wording ? { id: policy.id, version: wording.version, text: wording.text } : null;
}

const sameWording = (a, b) => !!a && !!b && a.id === b.id && a.version === b.version && a.text === b.text;

export function validateSearchPermission(permission) {
  const keys = ['schema', 'kind', 'id', 'networkId', 'threadId', 'searchProvider', 'query', 'recipients', 'wording', 'grantedAt', 'revokedAt'];
  if (!permission || typeof permission !== 'object' || Object.keys(permission).length !== keys.length || !keys.every(key => Object.hasOwn(permission, key))
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

/** A grant for one answer. `wording` must be the approved wording that was shown, character for character;
 * `recipients` are the execution contributors listed with it (empty when the answer runs on this device). */
export function createSearchPermission({ id, networkId, threadId, searchProvider, query, recipients, wording, grantedAt }) {
  if (!sameWording(wording, searchPermissionWording(searchProvider))) throw new Error('The shown search permission wording is not the approved text');
  return validateSearchPermission({ schema: REMOTE_PERMISSION_SCHEMA, kind: SEARCH_PERMISSION_KIND, id, networkId, threadId, searchProvider,
    query, recipients: [...recipients], wording: { id: wording.id, version: wording.version, text: wording.text }, grantedAt, revokedAt: null });
}
