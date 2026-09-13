import type { ResolvedConfig, Json } from '../config/index.js';
export function createCheckpoint(options: { config: ResolvedConfig; instanceId: string; state: Json; cryptoApi?: Crypto }): Promise<Json>;
export function verifyCheckpoint(options: { checkpoint: Json; config: ResolvedConfig; instanceId: string; cryptoApi?: Crypto }): Promise<Json>;
