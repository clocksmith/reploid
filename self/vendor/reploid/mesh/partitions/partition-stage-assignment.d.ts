export const STAGE_ASSIGNMENT_SCHEMA: 'reploid.stage-assignment/v1';
export const STAGE_COSTS_SCHEMA: 'reploid.stage-costs/v1';
/** Advertised only by a ranking coordinator: measured mean decode milliseconds per stage of its current route. */
export interface StageCostsClaim {
  schema: typeof STAGE_COSTS_SCHEMA; modelId: string; modelIdentity: string; planId: string; decodeMs: (number | null)[];
}
export interface StageDemand { index: number | null; reason: 'queue' | 'bottleneck' | null; queued: readonly number[] }
export function stageDemand(options: {
  model: { id: string; identity: string }; stageCount: number;
  capabilities: readonly { participantId: string; available: boolean; expiresAt: number; description?: unknown }[];
  now: number; maxOffersPerPeer: number; queueBound: number; bottleneckRatio: number;
}): StageDemand;
/** Advertised only by a contributor whose operator chose `auto`; a hint, never an assignment. */
export interface StageAssignmentClaim {
  schema: typeof STAGE_ASSIGNMENT_SCHEMA; modelId: string; modelIdentity: string; index: number | null;
}
export interface StageAssignmentDecision {
  index: number | null; reason: 'cold-least-supplied' | 'retain' | 'rebalance' | 'replicate-queue' | 'replicate-bottleneck'
    | 'waiting-for-route' | 'no-useful-assignment'; move: boolean;
  /** Distinct other participants per stage index: ready offers plus claims still preparing. */
  supply: readonly number[]; joiners: number;
}
export function planStageAssignment(options: {
  participantId: string; model: { id: string; identity: string }; stageCount: number;
  capabilities: readonly { participantId: string; available: boolean; expiresAt: number; description?: unknown }[];
  now: number; current?: number | null; maxOffersPerPeer: number; demand?: StageDemand | null;
}): StageAssignmentDecision;
