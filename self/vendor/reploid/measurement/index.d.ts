import type { SupplyLabel } from '../chat/supply-provenance.js';

export type CapacityUnit = 'attempt-slots' | 'bytes';
export type AdmissionOutcome = 'satisfactory' | 'unsatisfactory' | 'unassessed' | 'failed' | 'cancelled' | 'interrupted' | 'active' | 'unmatched';
export interface StageKey { participantId: string; modelIdentity: string; planId: string; stageIndex: number }
/** A contributor stage's known state over [from, to): `ready` is prepared and offered with the admitted capacity it declares.
 * Time no span covers is unknown; spans of one stage must not overlap. */
export interface ReadinessSpan extends StageKey {
  schema?: 'reploid.readiness-span/v1'; from: number; to: number; state: 'ready' | 'unready';
  capacity: { unit: CapacityUnit; amount: number } | null;
}
/** A contributor reservation record as residents keep it (`getState().reservations.records`). */
export interface AdmissionRecord {
  identity: { attemptId: string; modelIdentity?: string; planId?: string; participantA?: string; participantB?: string;
    route?: { modelIdentity: string; planId: string; stages: Array<{ participantId: string }> } };
  participantId: string; index: number; phase?: string; reservedAt: number | null; settlingAt?: number | null; settledAt: number | null;
  failure?: string | null; resources?: { attemptSlots?: number; attemptBytes?: number } | null;
  /** Last time a host observed this admission unsettled; it counts only to then, and later time is unknown. */
  observedUntil?: number | null;
  /** When it was certainly released (its host session had ended); unknown time stops there. Needs observedUntil. */
  releasedBy?: number | null;
}
/** The requester's outcome for an attempt; `satisfactory` comes from a quality decision, absent when none was made. */
export interface AttemptOutcome { attemptId: string; status: string; satisfactory?: boolean | null; supply?: SupplyLabel | null }
/** An accepted readiness contract for one exact stage; only `status: 'accepted'` counts as paid. */
export interface ReadinessContract extends StageKey { offerId: string; from: number; to: number; status: string | null }
export interface MaintainedCapacity {
  /** Null whenever any ready time has undeclared capacity or any time is unknown. */
  capacitySeconds: number | null; knownCapacitySeconds: number; paidCapacitySeconds: number; unpaidCapacitySeconds: number;
  readyMs: number; unreadyMs: number; unknownMs: number; undeclaredCapacityMs: number; paidUnknownMs: number;
}
export interface ConsumedCapacity {
  capacitySeconds: number; admissions: number; open: number; unknownAmount: number;
  byOutcome: Record<AdmissionOutcome, { admissions: number; capacitySeconds: number; paidCapacitySeconds: number }>;
}
export interface UtilizationRatios {
  /** Why a ratio is null: readiness-gaps, capacity-not-declared, unknown-consumption-amount, open-after-observation,
   * unassessed-completions, unmatched-admissions or active-attempts. */
  reasons: string[];
  usefulToMaintained: number | null; usefulToPaid: number | null; occupiedToMaintained: number | null;
}
export interface UtilizationTotals { unit: CapacityUnit | null; reason?: 'mixed-units'; maintained?: MaintainedCapacity; consumed?: ConsumedCapacity; ratios?: UtilizationRatios }
export interface CapacityUtilization {
  schema: 'reploid.capacity-utilization/v1'; interval: { from: number; to: number; durationMs: number }; observedUntil: number;
  contributors: Array<{ participantId: string; total: UtilizationTotals;
    stages: Array<StageKey & { unit: CapacityUnit; contracts: string[]; maintained: MaintainedCapacity; consumed: ConsumedCapacity; ratios: UtilizationRatios }> }>;
  routes: Array<UtilizationTotals & { route: { modelIdentity: string; planId: string; participants: string[] } }>;
  attempts: { total: number; bySupply: Record<SupplyLabel | 'unclassified', number>; byStatus: Record<string, number> };
}
export declare const CAPACITY_UTILIZATION_SCHEMA: 'reploid.capacity-utilization/v1';
export declare const READINESS_SPAN_SCHEMA: 'reploid.readiness-span/v1';
export declare const CAPACITY_UNITS: Readonly<Record<CapacityUnit, 'attemptSlots' | 'attemptBytes'>>;
export declare const ADMISSION_OUTCOMES: readonly AdmissionOutcome[];
export declare function summarizeCapacityUtilization(input: { interval: { from: number; to: number }; observedUntil?: number;
  readiness?: readonly ReadinessSpan[]; admissions?: readonly AdmissionRecord[]; attempts?: readonly AttemptOutcome[];
  contracts?: readonly ReadinessContract[] }): CapacityUtilization;
export declare function attemptOutcomesFromWorkspace(workspace: unknown): AttemptOutcome[];
export declare function readinessContractsFromOffers(offers: readonly unknown[]): ReadinessContract[];

export type ReadinessHost = 'node' | 'browser';
export type ReadinessSpanEnd = 'ready' | 'capacity-changed' | 'failed' | 'stopped' | 'not-admitting' | 'stage-changed'
  | 'unprepared' | 'observation-gap' | string;
/** One recorded copy of a span: written at open (`to: null`), at checkpoints (`to: null`, later `observedAt`) and at
 * close (`to`, `end`). A span whose last copy is open is known only through its `observedAt`. */
export interface ReadinessSpanRecord extends StageKey {
  schema: 'reploid.readiness-span/v1'; spanId: string; sessionId: string; sessionStartedAt: number; host: ReadinessHost;
  state: 'ready' | 'unready'; capacity: { unit: 'attempt-slots'; amount: number } | null;
  from: number; to: number | null; observedAt: number; end: ReadinessSpanEnd | null;
}
/** A resident admission as recorded: identities, times and slot counts only. `failure` is a fixed marker, never error text. */
export interface StageAdmissionRecord {
  schema: 'reploid.stage-admission/v1'; sessionId: string; sessionStartedAt: number; host: ReadinessHost; observedAt: number;
  participantId: string; index: number; phase: string | null; reservedAt: number; settlingAt: number | null; settledAt: number | null;
  failure: 'failed' | null;
  identity: { attemptId: string; modelIdentity?: string; planId?: string; participantA?: string; participantB?: string;
    route?: { modelIdentity: string; planId: string; stages: Array<{ index: number; participantId: string }> } };
  resources: { attemptSlots?: number; attemptBytes?: number } | null;
}
export type ReadinessRecord = ReadinessSpanRecord | StageAdmissionRecord;
export interface ReadinessRecorder {
  readonly sessionId: string;
  /** An automatic-partitions `getState()` snapshot; never throws. */
  observe(state: unknown): void;
  /** A resident this host prepared; its admissions are recorded from its own state until it closes. */
  watchResident(resident: { subscribe(listener: (state: unknown) => void): () => void }): void;
  /** Closes every open span now with `reason`; admissions keep recording. */
  end(reason?: string): void;
  /** `end`, then records each still-held admission's last observation and stops watching residents. */
  close(reason?: string): void;
  getState(): { sessionId: string; host: ReadinessHost; participantId: string; startedAt: number; observedAt: number;
    ended: boolean; closed: boolean; failures: number; stages: number; open: number; residents: number };
}
export interface UnterminatedSpan extends StageKey {
  spanId: string; sessionId: string; state: 'ready' | 'unready'; from: number; lastObservedAt: number;
}
export interface ReadinessRecordStore {
  write(record: ReadinessRecord): void;
  flush(): void;
  export(): { schema: 'reploid.capacity-utilization-input/v1'; readinessRecords: ReadinessRecord[]; readinessDropped: number };
  getState(): { pending: number; failures: number };
}
export declare const STAGE_ADMISSION_SCHEMA: 'reploid.stage-admission/v1';
export declare const UTILIZATION_INPUT_SCHEMA: 'reploid.capacity-utilization-input/v1';
export declare const READINESS_CHECKPOINT_MS: number;
export declare const READINESS_MAX_OBSERVATION_GAP_MS: number;
export declare const READINESS_STORE_MAX_RECORDS: number;
export declare const READINESS_HOSTS: readonly ReadinessHost[];
export declare function createReadinessRecorder(options: { participantId: string; host: ReadinessHost; write(record: ReadinessRecord): void;
  now?: () => number; sessionId?: string; checkpointMs?: number; maxObservationGapMs?: number }): ReadinessRecorder;
export declare function readinessInputFromRecords(records: readonly unknown[]): {
  readiness: Array<ReadinessSpan & { end?: string }>; admissions: AdmissionRecord[]; unterminated: UnterminatedSpan[]; zeroLength: number;
};
export declare function createReadinessRecordStore(options: { storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  key: string; maxRecords?: number }): ReadinessRecordStore;
