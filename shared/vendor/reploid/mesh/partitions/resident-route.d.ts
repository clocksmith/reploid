import type { OrderedResidentAllocation, OrderedDopplerResidentSession } from './resident-partition.js';
import type { RouteAttemptBinding, PartitionRouteStage } from './partition-contract.js';
import type { OrderedExecutionRuntime, OrderedStageDevice } from './partition-route-execution.js';
export function createResidentRouteBinding(options: { allocation: Omit<OrderedResidentAllocation, 'signal'>;
  ordered: { stage: PartitionRouteStage; runtime: Pick<OrderedExecutionRuntime,
    'hashLayerPartitionPlan' | 'hashPartitionGeneration' | 'getPartitionActivationContract'> } }): {
  stage: Readonly<PartitionRouteStage>; identity(input: unknown): RouteAttemptBinding;
  prepare(): Promise<void>; generationDigest(generation: Record<string, unknown>): string | Promise<string>;
  wrap(session: OrderedDopplerResidentSession): Omit<OrderedDopplerResidentSession, 'executeStage' | 'closeAttempt' | 'tokenize'> & {
    executeStage: OrderedStageDevice['executeStage']; closeAttempt: OrderedStageDevice['closeAttempt'];
    tokenize(input: { identity: RouteAttemptBinding; messages: Array<{ role: string; content: string }>; signal?: AbortSignal }): Promise<unknown> };
};
