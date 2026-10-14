export declare const REMOTE_PERMISSION_SCHEMA: 'reploid.remote-permission/v1';
export type RemoteDisclosure = 'public' | 'partition-activations-and-tokens' | 'ordered-partition-activations-and-tokens';
export declare const REMOTE_DISCLOSURES: readonly RemoteDisclosure[];
/** The standing permission to send conversations to remote contributors. revokedAt stops new disclosures only. */
export interface RemotePermission {
  schema: typeof REMOTE_PERMISSION_SCHEMA; id: string; sharingScope: string; disclosure: RemoteDisclosure;
  modelIdentities: string[]; adapterIdentities: string[]; grantedAt: number; revokedAt: number | null;
}
/** What one remote request needs: compared exactly against a permission by remotePermissionCovers. */
export interface RemotePermissionNeed {
  sharingScope: string; disclosure: string; modelId: string; modelIdentity: string; adapterIdentities: string[];
}
export declare function remoteDisclosureKind(model: { partition?: { schema?: string } | null } | null | undefined): RemoteDisclosure;
export declare function remotePermissionNeed(input: { sharingScope: string; disclosure: string;
  model: { id: string; identity: string; adapters?: Array<{ identity: string }> } }): RemotePermissionNeed;
/** Inside exactly when unrevoked with the same sharing scope and disclosure kind, listing the model identity and every adapter identity. */
export declare function remotePermissionCovers(permission: RemotePermission | null | undefined, need: RemotePermissionNeed | null | undefined): boolean;
export declare function createRemotePermission(input: { id: string; need: RemotePermissionNeed; grantedAt: number;
  catalog?: ReadonlyArray<{ identity: string; availableAdapters?: ReadonlyArray<{ identity: string }> }> }): RemotePermission;
export declare function validateRemotePermission(permission: unknown): RemotePermission;
