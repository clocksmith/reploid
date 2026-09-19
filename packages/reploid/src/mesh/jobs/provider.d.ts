import type { createPackPeerProvider } from '../../contracts/pool/peer-pack-provider.js';
export function createPackProviderFactory(ports: Readonly<Record<string, unknown>>): { createPackPeerProvider: typeof createPackPeerProvider };
