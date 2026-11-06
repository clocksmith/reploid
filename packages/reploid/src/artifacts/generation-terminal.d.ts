import type { SigningIdentity } from './identity.js';
export interface GenerationTerminalBinding {
  requestId: string; provider: string; consumer: string; model: string; modelIdentity: string; adapterIdentities: string[]; inputDigest: string;
}
export interface GenerationTerminal extends GenerationTerminalBinding {
  schema: 'reploid.generation-terminal/v1'; status: 'cancelled' | 'failed'; cleanup: 'settled'; usage: null;
  timestamp: number; publicJwk: JsonWebKey; signature: string;
}
export function signGenerationTerminal(binding: GenerationTerminalBinding, status: 'cancelled' | 'failed', identity: SigningIdentity): Promise<GenerationTerminal>;
export function verifyGenerationTerminal(value: unknown, binding: GenerationTerminalBinding): Promise<boolean>;
