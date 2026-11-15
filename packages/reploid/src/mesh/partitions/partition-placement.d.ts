import type { OrderedPartitionPlan, OrderedPartitionRuntime, PartitionActivationContract, PartitionRoute } from './partition-contract.js';
export interface OrderedPartitionOffer {
  id: string; identity: string; availability: 'ready' | 'unavailable'; planId: string;
  index: number; residentId: string; executionId: string; activation: PartitionActivationContract;
  partition?: { schema: 'reploid.partition-selection/v2'; planId: string; coordinatorId: string; route: PartitionRoute };
}
export interface OrderedPartitionCapability {
  participantId: string; transportId: string; observedAt: number; expiresAt: number; available: boolean;
  description: { schema: 'reploid.partition-capability/v2'; participantId: string;
    phase: 'idle' | 'waiting' | 'loading' | 'ready' | 'stopping' | 'failed'; models: OrderedPartitionOffer[];
    capacity: { active: number; availableSlots: number; closed: boolean } };
}
export interface PartitionRouteSelectionLimits { maxStages: number; maxPeers: number; maxOffersPerPeer: number; maxSelectionSteps: number }
export interface PlacementModel {
  id: string; identity: string; adapters?: readonly { identity: string; baseModelIdentity: string }[];
  partitionContributionIndexes?: number[];
  availability?: string; partition?: { schema?: string };
}
export interface ObservedPartitionCapability {
  participantId: string; transportId: string; observedAt: number; expiresAt: number;
  available: boolean; reason?: string;
  description: {
    schema?: string; phase?: string; offer?: PlacementModel; models?: PlacementModel[];
    index?: number | null; eligibleIndexes?: number[]; placement?: string[];
    capacity?: { active?: number; availableSlots?: number; closed?: boolean;
      attemptQueue?: { queued: number; maxQueued: number } };
  };
}
export function selectPartitionPlacement(options: {
  participantId: string; offer: PlacementModel; localIndex: number | null;
  previous?: readonly string[] | null; capabilities: ObservedPartitionCapability[];
}): { participants: string[]; reason: string; eligibility: {
  participantId: string; transportId: string; observedAt: number; expiresAt: number;
  reason: string | undefined; index: number | null; indexes: number[];
}[] };
export function selectPartitionExecution(options: {
  model: PlacementModel; capabilities: ObservedPartitionCapability[]; ordered?: boolean;
}): { transportId: string | null; eligibility: {
  participantId: string; transportId: string; reason: string | undefined; eligible: boolean;
  capacity: ObservedPartitionCapability['description']['capacity'] | null;
}[] };
export { validateOrderedPartitionCapability, isOrderedPartitionEntryModel } from './partition-contract.js';
export type PartitionRouteStageCandidate = import('./partition-contract.js').PartitionRouteStage;
/** Eligible offers per stage index, sorted by participant; shared by matching and opt-in ranking. */
export function eligiblePartitionStages(options: { runtime: OrderedPartitionRuntime; plan: OrderedPartitionPlan;
  model: { id: string; identity: string }; capabilities: OrderedPartitionCapability[];
  limits: PartitionRouteSelectionLimits; now: number }): Promise<{ plan: OrderedPartitionPlan; model: { id: string; identity: string };
    planId: string; activation: PartitionActivationContract; candidates: PartitionRouteStageCandidate[][];
    eligibility: { participantId: string; index: number | null; eligible: boolean; reason: string }[] }>;
/** Availability hints for a new attempt only; grants and reservations remain authoritative. */
export function selectPartitionRoute(options: { runtime: OrderedPartitionRuntime; plan: OrderedPartitionPlan;
  model: { id: string; identity: string }; capabilities: OrderedPartitionCapability[];
  limits: PartitionRouteSelectionLimits; now: number }): Promise<Readonly<{ route: PartitionRoute | null;
    reason: string; selectionSteps: number; eligibility: readonly Readonly<{ participantId: string; index: number | null;
      eligible: boolean; reason: string }>[] }>>;
