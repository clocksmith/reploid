export interface SigningIdentity {
  version: number; algorithm: 'Ed25519' | 'ECDSA'; peerId: string; publicJwk: JsonWebKey; privateJwk: JsonWebKey;
  [field: string]: unknown;
}
export function createSigningIdentity(options: { algorithm: SigningIdentity['algorithm']; cryptoApi?: Crypto }): Promise<SigningIdentity>;
export function createPeerIdFromPublicJwk(key: JsonWebKey, cryptoApi?: Crypto): Promise<string>;
export function getIdentityImportAlgorithm(value?: object): AlgorithmIdentifier | EcKeyImportParams;
export function getIdentitySignAlgorithm(value?: object): AlgorithmIdentifier | EcdsaParams;
export function importSigningKey(bundle: SigningIdentity, cryptoApi?: Crypto): Promise<CryptoKey>;
export function importVerificationKey(bundle: SigningIdentity | JsonWebKey, cryptoApi?: Crypto): Promise<CryptoKey>;
export function encodeBytes(value: unknown): Uint8Array;
export function fromBase64Url(value: string): Uint8Array;
export function toBase64Url(value: ArrayBuffer | Uint8Array): string;
