import type { createCustodyExchange } from './exchange.js';

type Exchange = ReturnType<typeof createCustodyExchange>;
export type SharedFileSource = 'cached-model' | 'weight-supply';
export const SHARED_FILE_SOURCES: readonly SharedFileSource[];
export interface SharedFile { path: string; role: string; hashAlgorithm: 'sha256' | 'blake3'; hash: string; sizeBytes: number }
export interface SharedInventoryFile extends SharedFile { sources: SharedFileSource[]; offered: boolean }
export function createSharedFileInventory(options: { exchange: Exchange; maxFiles: number; onChange?(): void }): Readonly<{
  set(source: SharedFileSource, files: SharedFile[]): Promise<unknown>;
  holds(file: SharedFile, source?: SharedFileSource | null): boolean;
  isServing(file: SharedFile): boolean;
  pause(): Promise<unknown>;
  resume(): void;
  getState(): { paused: boolean; sharing: boolean; files: SharedInventoryFile[] };
  source(name: SharedFileSource): Pick<Exchange, 'getState' | 'has' | 'acquire' | 'announceDemand' | 'offer' | 'stopSupply'>;
}>;
