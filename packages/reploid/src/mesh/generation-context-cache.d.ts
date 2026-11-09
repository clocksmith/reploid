export interface RuntimeGenerationContext {
  getStats(): Readonly<{ allocatedBytes: number; cachedTokens: number; reusedTokens: number; status: string }>;
  close(): void;
}
export function createGenerationContextCache(options: {
  policy: { maxEntries: number; maxBytes: number; maxEntryBytes: number; idleMs: number };
  create(options: { maxBytes: number }): RuntimeGenerationContext;
  now?: () => number;
}): {
  acquire(key: string | null): { context: RuntimeGenerationContext; release(options?: { discard?: boolean }): void } | null;
  close(): void;
};
