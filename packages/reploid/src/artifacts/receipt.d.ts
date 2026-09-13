import type { SigningIdentity } from './identity.js';
export interface Receipt extends Record<string, unknown> {
  version: number; receiptId: string; provider: string; consumer: string; jobHash: string; model: string;
  inputTokens: number; outputTokens: number; status: string; timestamp: number;
  providerSignature?: string; providerKey?: JsonWebKey; consumerSignature?: string; consumerKey?: JsonWebKey;
}
export function getReceiptPayload(receipt?: Partial<Receipt>): Receipt;
export function canonicalizeReceiptPayload(receipt?: Partial<Receipt>): string;
export function createReceiptDraft(input?: Partial<Receipt>, cryptoApi?: Crypto): Promise<Receipt>;
export function signReceiptDraft(receipt: Receipt, provider: SigningIdentity, cryptoApi?: Crypto): Promise<Receipt>;
export function countersignReceipt(receipt: Receipt, consumer: SigningIdentity, cryptoApi?: Crypto): Promise<Receipt>;
export function verifyReceipt(receipt: Receipt, cryptoApi?: Crypto): Promise<{ providerValid: boolean; consumerValid: boolean; valid: boolean }>;
declare const api: { getReceiptPayload: typeof getReceiptPayload; canonicalizeReceiptPayload: typeof canonicalizeReceiptPayload;
  createReceiptDraft: typeof createReceiptDraft; signReceiptDraft: typeof signReceiptDraft; countersignReceipt: typeof countersignReceipt; verifyReceipt: typeof verifyReceipt };
export default api;
