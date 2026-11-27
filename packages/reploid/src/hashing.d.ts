type CryptoLike = { subtle?: SubtleCrypto } | null | undefined;
export function sha256Bytes(value: unknown, cryptoApi?: CryptoLike): Promise<ArrayBuffer>;
export function sha256HexUnprefixed(value: unknown, cryptoApi?: CryptoLike): Promise<string>;
export function sha256Digest(value: unknown, cryptoApi?: CryptoLike): Promise<string>;
/** @deprecated Use sha256Digest for a prefixed digest. */
export const sha256Hex: typeof sha256Digest;
