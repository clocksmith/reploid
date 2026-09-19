import type { JsonValue } from '../../contracts/pool/pack-operation-adapters.js';
export function createPackEpisodeVerifier(ports: Readonly<Record<string, unknown>>): { verifyPackPeerEpisode(input: Readonly<Record<string, unknown>>): Promise<JsonValue> };
