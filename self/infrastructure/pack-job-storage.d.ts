type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type ProviderAttemptState = 'accepted' | 'running' | 'completed' | 'cancelled' | 'interrupted' | 'expired';
export type ProviderUpdateStatus = 'partial' | 'completed' | 'cancelled' | 'failed' | 'busy';
export interface ProviderPersistencePolicy {
  readonly databaseName: string;
  readonly databaseVersion: number;
  readonly storeName: string;
  readonly recordSchema: string;
  readonly legacyRecordSchema: string;
  readonly maxRecords: number;
  readonly recordCeiling: number;
  readonly maxSavedBytes: number;
  readonly byteCeiling: number;
  readonly retentionMs: number;
  readonly maxFutureMs: number;
  readonly maxIdentityCharacters: number;
  readonly storageTimeoutMs: number;
  readonly storageFailureBehavior: 'reject';
  readonly cleanup: 'expire-then-delete-after-retention';
  readonly durability: 'strict';
  readonly states: readonly ProviderAttemptState[];
  readonly outcomeStates: Readonly<Record<ProviderUpdateStatus, ProviderAttemptState>>;
  readonly legacyStates: Readonly<Record<string, ProviderAttemptState>>;
}
export interface ProviderAttemptBinding {
  readonly requestHash: string;
  readonly assignmentId: string;
  readonly operation: { readonly name: string; readonly version: number };
  readonly model: Readonly<Record<string, JsonValue>>;
  readonly adapterSet: readonly JsonValue[];
  readonly attemptNumber: number;
}
export interface ProviderAttemptDescriptor {
  readonly requesterId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly jobHash: string;
  readonly expiresAt: number;
  /** Null only for a cancellation received before its signed job. */
  readonly binding: ProviderAttemptBinding | null;
}
export type ProviderStoredUpdate = Readonly<Record<string, JsonValue>> & {
  readonly messageHash: string;
  readonly body: Readonly<Record<string, JsonValue>> & {
    readonly jobHash: string;
    readonly requestHash: string;
    readonly updateIndex: number;
    readonly previousUpdateHash: string | null;
    readonly status: ProviderUpdateStatus;
  };
};
export interface ProviderAttemptRecord extends ProviderAttemptDescriptor {
  readonly schema: 'reploid.pack-job-journal/v2';
  readonly key: string;
  readonly owner: string;
  readonly status: ProviderAttemptState;
  readonly outcome: string | null;
  readonly retainUntil: number;
  readonly updates: readonly ProviderStoredUpdate[];
}
export interface PackJobJournalStats {
  readonly attempts: number;
  readonly storedBytes: number;
  readonly states: Readonly<Record<ProviderAttemptState, number>>;
  readonly maxAttempts: number;
  readonly maxBytes: number;
  readonly retentionMs: number;
  readonly storage: 'indexeddb';
  readonly persistence: 'browser-managed';
}
export interface PackJobJournal {
  claim(value: ProviderAttemptDescriptor & { readonly binding: ProviderAttemptBinding }, owner: string): Promise<{ created: boolean; record: ProviderAttemptRecord }>;
  markRunning(value: ProviderAttemptDescriptor, owner: string): Promise<ProviderAttemptRecord>;
  append(value: ProviderAttemptDescriptor, owner: string, message: ProviderStoredUpdate): Promise<ProviderAttemptRecord>;
  cancel(value: ProviderAttemptDescriptor, owner: string): Promise<ProviderAttemptRecord>;
  getStats(): Promise<PackJobJournalStats>;
  close(): void;
}
export function openPackJobJournal(options: { providerId: string; policy: ProviderPersistencePolicy; name?: string;
  maxAttempts?: number; maxBytes?: number; indexedDB?: IDBFactory }): Promise<PackJobJournal>;
