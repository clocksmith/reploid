export const STAGE_ASSIGNMENT_SCHEMA: 'reploid.stage-assignment/v1';
/** Advertised only by a contributor whose operator chose `auto`; a hint, never an assignment. */
export interface StageAssignmentClaim {
  schema: typeof STAGE_ASSIGNMENT_SCHEMA; modelId: string; modelIdentity: string; index: number | null;
}
export interface StageAssignmentDecision {
  index: number; reason: 'cold-least-supplied' | 'retain' | 'rebalance'; move: boolean;
  /** Distinct other participants per stage index: ready offers plus claims still preparing. */
  supply: readonly number[]; joiners: number;
}
export function planStageAssignment(options: {
  participantId: string; model: { id: string; identity: string }; stageCount: number;
  capabilities: readonly { participantId: string; available: boolean; expiresAt: number; description?: unknown }[];
  now: number; current?: number | null; maxOffersPerPeer: number;
}): StageAssignmentDecision;
