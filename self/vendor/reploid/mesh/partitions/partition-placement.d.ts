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
export { validateOrderedPartitionCapability, isOrderedPartitionEntryModel } from './partition-contract.js';
/** Availability hints for a new attempt only; grants and reservations remain authoritative. */
export function selectPartitionRoute(options: { runtime: OrderedPartitionRuntime; plan: OrderedPartitionPlan;
  model: { id: string; identity: string }; capabilities: OrderedPartitionCapability[];
  limits: PartitionRouteSelectionLimits; now: number }): Promise<Readonly<{ route: PartitionRoute | null;
    reason: string; selectionSteps: number; eligibility: readonly Readonly<{ participantId: string; index: number | null;
      eligible: boolean; reason: string }>[] }>>;
