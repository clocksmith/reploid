// Keep a failed/closed source's diagnostic separate from successful retry owners.
export const collectNativeSourceReceipts = sources => Promise.all(sources.map(async (source, sourceIndex) => {
  try {
    return { sourceIndex, generic: source.getReceipt(),
      gather: source.getGatherReceipt ? await source.getGatherReceipt() : null };
  } catch (error) {
    return { sourceIndex, receiptFailure: String(error) };
  }
}));

// Gather receipts require open workers and belong to the pre-close snapshot.
// Generic counters remain readable after close; failures here must propagate.
export const collectClosedNativeSourceReceipts = sources => sources.map((source, sourceIndex) => ({
  sourceIndex, generic: source.getReceipt(),
}));
