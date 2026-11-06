import type { Receipt } from './receipt.js';
export function wholeModelReceiptFields(receipt: Partial<Receipt>): Partial<Receipt>;
export function measureWholeModelReceipt(messages: unknown, result: Record<string, unknown>): Promise<Partial<Receipt> | null>;
export function matchesWholeModelReceipt(receipt: Receipt, messages: unknown, result: Record<string, unknown>): Promise<boolean>;
