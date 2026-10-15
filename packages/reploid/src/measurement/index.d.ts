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
