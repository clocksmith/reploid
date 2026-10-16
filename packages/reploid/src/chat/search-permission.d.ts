import type { PermissionWording, REMOTE_PERMISSION_SCHEMA } from './remote-permission.js';
/** Permission for one search-backed answer: its query to the named search service and its passages to the listed contributors. */
export interface SearchPermission {
  schema: typeof REMOTE_PERMISSION_SCHEMA; kind: 'search-answer'; id: string; networkId: string; threadId: string;
  searchProvider: string; /** Host of the person-chosen search server; null for fixed services. */ searchServer: string | null; /** Verified search contributor, distinct from model executors. */ searchPeer?: string;
  query: string; recipients: string[]; wording: PermissionWording; grantedAt: number; revokedAt: null;
}
export declare const SEARCH_PERMISSION_KIND: 'search-answer';
export declare const SEARCH_RECIPIENTS_CHANGED: string;
/** The approved wording for a search service, or null when none is approved. */
export declare function searchPermissionWording(searchProvider: string): PermissionWording | null;
export declare function createSearchPermission(input: { id: string; networkId: string; threadId: string; searchProvider: string; searchServer?: string | null; searchPeer?: string | null; query: string;
  recipients: readonly string[]; wording: PermissionWording; grantedAt: number }): SearchPermission;
export declare function validateSearchPermission(permission: unknown): SearchPermission;
