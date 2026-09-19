import type { createPackPeerRequester } from '../../contracts/pool/peer-pack-requester.js';
export function createPackRequesterFactory(ports: Readonly<Record<string, unknown>>): { createPackPeerRequester: typeof createPackPeerRequester };
