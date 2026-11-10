type CryptoLike = { subtle?: SubtleCrypto } | null | undefined;
export function sha256Bytes(value: unknown, cryptoApi?: CryptoLike): Promise<ArrayBuffer>;
export function sha256HexUnprefixed(value: unknown, cryptoApi?: CryptoLike): Promise<string>;
export function sha256Hex(value: unknown, cryptoApi?: CryptoLike): Promise<string>;
