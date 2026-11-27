/**
 * The Records page ("Recent jobs", also /history) as the screen sees it. The host's records model
 * (apps/poolday/host/decisions/records.js) produces it from this browser's per-room ledgers.
 */
export type RecordFacet = 'all' | 'request' | 'answer' | 'contribution' | 'room';

export type RecordRow = {
  readonly id: string;
  readonly type: string;
  readonly time: string;
  readonly iso: string;
  readonly title: string;
  readonly meta: string;
  readonly detail: string;
  readonly open: boolean;
};

export type RoomActivity =
  | { readonly state: 'local' | 'checking' | 'error'; readonly text: string }
  | { readonly state: 'ready'; readonly row: ReadonlyArray<string>; readonly recent: string };

export type RecordsSnapshot = {
  readonly roomId: string;
  readonly title: string;
  readonly body: string;
  readonly facet: RecordFacet;
  readonly facets: ReadonlyArray<{ readonly id: RecordFacet; readonly label: string; readonly count: number }>;
  readonly hasRecords: boolean;
  readonly records: ReadonlyArray<RecordRow>;
  readonly open: Readonly<Record<string, boolean>>;
  readonly roomActivity: RoomActivity;
  readonly peerScores: ReadonlyArray<ReadonlyArray<string>>;
  readonly receipts: ReadonlyArray<ReadonlyArray<string>>;
  readonly lookup: { readonly hash: string; readonly pending: boolean; readonly result: unknown };
  readonly documentHistory: ReadonlyArray<{ readonly summary: string; readonly detail: string }>;
  readonly protocol: string;
};

export type RecordsServices = {
  readonly dispose: () => void;
  readonly getSnapshot: () => RecordsSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly setFacet: (facet: RecordFacet) => void;
  /** Remembers whether one record or tool disclosure is open, per room. */
  readonly setDisclosure: (id: string, open: boolean) => void;
  readonly setLookupHash: (hash: string) => void;
  readonly lookupReceipt: () => Promise<void>;
  /** The lookup result as the JSON the vanilla page showed. */
  readonly resultText: (result: unknown) => string;
};
