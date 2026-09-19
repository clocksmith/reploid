export { createMemoryStore, createVfs } from '../artifacts/store.js';
export * from '../artifacts/identity.js';
export * from '../artifacts/receipt.js';
export { default as receipt } from '../artifacts/receipt.js';
import type { Store } from '../artifacts/store.js';
export function createIndexedDbStore(options: {
  databaseName: string; storeName: string; version: number; openTimeoutMs: number;
  indexedDB?: IDBFactory; keyPath?: string | null;
}): Store & { init(): Promise<boolean> };
