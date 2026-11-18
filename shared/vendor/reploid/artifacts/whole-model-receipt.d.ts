import type { Receipt } from './receipt.js';
export function wholeModelReceiptFields(receipt: Partial<Receipt>): Partial<Receipt>;
export interface WholeModelReceiptBinding { settingsDigest?: string | null; constraintIdentity?: string | null }
export function measureWholeModelReceipt(messages: unknown, result: Record<string, unknown>, bound?: WholeModelReceiptBinding): Promise<Partial<Receipt> | null>;
export function matchesWholeModelReceipt(receipt: Receipt, messages: unknown, result: Record<string, unknown>, bound?: WholeModelReceiptBinding): Promise<boolean>;
