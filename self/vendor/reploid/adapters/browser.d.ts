export { createMemoryStore, createVfs } from '../artifacts/store.js';
export { createSigningIdentity } from '../artifacts/identity.js';
import type { Store } from '../artifacts/store.js';
export function createIndexedDbStore(options: {
  databaseName: string; storeName: string; version: number; openTimeoutMs: number;
  indexedDB?: IDBFactory; keyPath?: string | null;
}): Store;
