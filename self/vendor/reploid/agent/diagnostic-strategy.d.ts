import type { Json, ResolvedConfig, DeepReadonly } from '../config/index.js';
import type { Authorize } from './index.js';
import type { ExecutionEvent } from './engine-contracts.js';
export interface DiagnosticModel {
  schema: 'reploid.diagnostic-model/v1'; id: string;
  hypotheses: string[]; prior: number[];
  evidence: { kind: 'synthetic' | 'host-supplied'; reference: string };
  actions: { id: string; tool: string; args: Record<string, Json>; cost: number; evidenceGroup: string;
    outcomes: string[]; likelihoods: number[][] }[];
  decisions: { id: string; utilities: number[] }[];
}
export interface DiagnosticPolicy {
  schema: 'reploid.diagnostic-policy/v1'; objective: 'task-value' | 'decision-value' | 'utility-information';
  costBudget: number; maxActions: number; informationWeight: number; minimumScore: number;
}
export interface DiagnosticBranch { outcomeId: string; probability: number; posterior: number[] | null }
export interface DiagnosticRanking {
  actionId: string; cost: number; informationGain: number; decisionValue: number;
  expectedUtility: number; score: number; outcomes: DiagnosticBranch[];
}
export interface DiagnosticRecommendation { decisionId: string; expectedUtility: number }
export interface BeliefPlanner {
  readonly model: DeepReadonly<DiagnosticModel>; readonly policy: DeepReadonly<DiagnosticPolicy>;
  initialBelief(): number[];
  decide(belief: number[]): DiagnosticRecommendation;
  update(input: { belief: number[]; actionId: string; outcomeId: string }): DiagnosticBranch & { posterior: number[] };
  rank(input: { belief: number[]; remainingBudget: number; excludedActionIds?: string[] }): DiagnosticRanking[];
}
export interface DiagnosticObservation { outcomeId: string; evidenceId: string }
export interface DiagnosticOptions {
  model: DiagnosticModel; policy: DiagnosticPolicy; config: ResolvedConfig;
  ports: { instanceId: string; authorize: Authorize;
    executeTool(name: string, args: Record<string, Json>, control: { signal: AbortSignal }): DiagnosticObservation | Promise<DiagnosticObservation>;
    onExecutionEvent?(event: ExecutionEvent): void };
}
export type DiagnosticStatus = 'idle' | 'running' | 'stopped' | 'blocked' | 'cancelled' | 'closed';
export interface DiagnosticState {
  schema: 'reploid.diagnostic-state/v1'; modelId: string; status: DiagnosticStatus; belief: number[];
  spent: number; attempted: string[]; recommendation: DiagnosticRecommendation;
  history: { actionId: string; cost: number; ranking: DiagnosticRanking[];
    status: 'pending' | 'observed' | 'failed' | 'denied' | 'cancelled' | 'rejected';
    observation: DiagnosticObservation | null; error: string | null }[];
}
export interface DiagnosticInvestigation {
  run(): Promise<DiagnosticState>; getSnapshot(): DiagnosticState; getExecutionEvents(): ExecutionEvent[];
  cancel(): void; close(): Promise<void>;
  /** Detached audit record. Does not authorize execution or automatically restore a session. */
  checkpoint(): { model: DiagnosticModel; policy: DiagnosticPolicy; state: DiagnosticState };
}
export function createBeliefPlanner(model: DiagnosticModel, policy: DiagnosticPolicy): BeliefPlanner;
export function createDiagnosticInvestigation(options: DiagnosticOptions): DiagnosticInvestigation;
