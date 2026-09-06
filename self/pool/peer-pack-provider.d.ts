import type { PackPeerIdentity, PackPeerJobBody, SignedPackPeerMessage, PackPeerModel, PackPeerLimits, PackProviderAdvertBody } from './peer-pack-job.js';
import type { PackPeerBus } from './peer-pack-requester.js';
import type { PackOperationRegistry } from './pack-operation-adapters.js';
import type { CurrentPackJobPolicy } from './peer-pack-job-policy.js';
import type { LocalPackExecutor } from './local-pack-executor.js';
import type { PeerAdapterResolver } from './peer-adapter-execution.js';
import type { ProviderCapabilities } from './peer-capabilities.js';
import type { PackJobJournal, PackJobJournalStats } from '../infrastructure/pack-job-storage.js';
export interface PackPeerProviderState {
  closed: boolean; active: boolean; draining: boolean; attempts: number;
  retainedBytes: number; queued: number; queuedBytes: number;
}
export interface PackPeerProviderOptions {
  identity: PackPeerIdentity; bus: PackPeerBus; models: readonly PackPeerModel[];
  authorize(job: SignedPackPeerMessage<PackPeerJobBody>): boolean | Promise<boolean>;
  adapterResolver?: PeerAdapterResolver | null; registry?: PackOperationRegistry; executor?: LocalPackExecutor;
  policy?: CurrentPackJobPolicy; journal?: PackJobJournal | null; journalName?: string;
  maxAttempts?: number; maxRetainedBytes?: number; onError?: (error: Error) => void;
}
export interface PackPeerProvider {
  createAdvert(options: { limits: PackPeerLimits; capabilities: ProviderCapabilities; expiresAt: number }): Promise<SignedPackPeerMessage<PackProviderAdvertBody>>;
  getState(): PackPeerProviderState;
  getJournalStats(): Promise<PackJobJournalStats>;
  close(): Promise<void>;
}
export function createPackPeerProvider(options: PackPeerProviderOptions): PackPeerProvider;
