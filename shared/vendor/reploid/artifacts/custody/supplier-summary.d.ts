export const MAX_NAMED_SUPPLIERS: number;
export const OTHER_SUPPLIERS: 'other';
export type SupplierSummary = Record<string, { pieces: number; bytes: number }>;
export function supplierLabel(id: unknown): string;
export function countSupplier(summary: SupplierSummary, id: unknown, bytes: number, maxSuppliers?: number): SupplierSummary;
