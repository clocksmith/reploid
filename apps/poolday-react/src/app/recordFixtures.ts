// Stages Recent jobs and Research Room-1 for the design page over in-memory browser storage, so each specimen runs the
// shipped page on its host model without touching this profile's ledgers.
type MemoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function memoryStorage(seed: Readonly<Record<string, unknown>> = {}): MemoryStorage {
  const values = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, String(value)),
    removeItem: (key) => void values.delete(key),
  };
}

export const RECORDS_ROOM = 'design-records';
export const ROOM_ROOM = 'design-room';

/** One saved answer receipt and one remembered open record, for the timeline with records. */
export const recordsSeed = {
  [`reploid.receiptLedgerRows.v1::${RECORDS_ROOM}`]: [
    {
      receiptHash: 'sha256:5f2c0e9b7a41d3c8e6f0a9b2c4d6e8f01a3c5e7f9b1d3f5a7c9e1b3d5f7a9c1e',
      jobId: '0f9e8d7c6b5a49382716051423324150',
      provider: 'peer:design-contributor-0001',
      fidelity: 'verified',
      speed: '42 tok/s',
      occurredAt: '2026-11-25T14:05:00.000Z',
      record: { requesterAcceptance: { accepted: true }, completedAt: '2026-11-25T14:05:00.000Z' },
    },
  ],
};
