export const ROUTE_COST_POLICY_SCHEMA: 'reploid.route-cost-policy/v1';
export const ROUTE_SELECTION_SCHEMA: 'reploid.route-selection/v1';
export const ROUTE_RANKING_WORK_LIMIT: string;
/** Every member is required; see partition-route-ranking.js for the cost model. Amounts are in `unit`. */
export interface RouteCostPolicy {
  schema: 'reploid.route-cost-policy/v1';
  /** Version identity recorded with every decision. */
  id: string;
  unit: string;
  /** Totals equal within this many units tie and fall back to participant ids. */
  resolution: number;
  prices: { latencyPerMs: number; queueingPerMs: number; transferPerMs: number; preparationPerMs: number;
    refundPerFailure: number; retryPerFailure: number };
  /** Declared priors for unmeasured or stale (older than maxObservationAgeMs) measurements. */
  unknown: { prefillMsPerToken: number; decodeMsPerToken: number; transferMsPerToken: number; openingMs: number;
    maxObservationAgeMs: number };
  /** Prior pseudo-counts for stage admission refusals and route execution failures. */
  readiness: { priorAttempts: number; priorRefusals: number };
  failure: { priorAttempts: number; priorFailures: number };
  reserve: { spareSlots: number; perMissingSlot: number };
}
export function validateRouteCostPolicy(policy: unknown): Readonly<RouteCostPolicy>;
export interface RouteObservation {
  planId: string; participantId: string; index: number; at: number | null; samples: number;
  decodeMs: number | null; transferMs: number | null; prefillMsPerToken: number | null;
  openingMs: number | null; openedAt: number | null; admissions: number; refusals: number;
}
export interface RouteOutcome { planId: string; participants: string[]; at: number | null; executions: number; failures: number }
type ObservedRoute = { stages: readonly { index: number; participantId: string }[] };
export interface RouteObservations {
  /** Folds one completed attempt's ordered phases (partition-summary.js) into per-stage estimates; returns stages recorded. */
  record(input: { planId: string; route: ObservedRoute; phases: Record<string, any> | null | undefined; at: number }): number;
  recordOutcome(input: { planId: string; route: ObservedRoute; admitted: number; refused: boolean;
    execution: 'completed' | 'failed' | null; at: number }): void;
  recordOpening(input: { planId: string; stage: { index: number; participantId: string }; openingMs: number; at: number }): void;
  get(planId: string, participantId: string, index: number): RouteObservation | null;
  getRoute(planId: string, participants: readonly string[]): RouteOutcome | null;
  snapshot(): RouteObservation[];
  snapshotRoutes(): RouteOutcome[];
}
export function createRouteObservations(options: { maxEntries: number; smoothing: number }): RouteObservations;
export interface RankingCandidate {
  index: number; participantId: string; transportId?: string; residentId?: string; executionId?: string;
  capacity: { active: number; availableSlots: number; closed?: boolean; queued?: number };
  /** Admitted allocation headroom reported for this candidate; omitted means not reported. */
  memory?: { availableBytes: number } | null;
  /** The coordinator's own stage, which needs no channel opening. */
  local?: boolean;
  [key: string]: unknown;
}
export type RouteCostComponents = Record<'latency' | 'queueing' | 'transfer' | 'preparation' | 'readiness' | 'failure' | 'reserve', number>;
export interface RouteCostExpectation {
  latencyMs: number; queueingMs: number; transferMs: number; preparationMs: number; reserveSlots: number;
  refusalProbability: number; failureProbability: number; attemptsPerAnswer: number;
}
export interface RankedRoute {
  stages: RankingCandidate[]; participants: string[]; cost: number; units: number; prepared: boolean; measured: boolean;
  components: RouteCostComponents; expected: RouteCostExpectation;
  inputs: { stages: Record<string, unknown>[]; execution: { executions: number; failures: number } };
}
export function rankPartitionRoutes(options: { planId: string; candidates: RankingCandidate[][];
  observations: Pick<RouteObservations, 'get' | 'getRoute'>;
  workload: { promptTokens: number; expectedTokens: number; allocationBytes: number };
  limits: { maxParticipants: number; maxRoutes: number; maxSelectionSteps: number };
  policy: RouteCostPolicy; now: number;
  open?: readonly (readonly { participantId: string; transportId?: string; residentId?: string; executionId?: string }[])[] }): readonly Readonly<RankedRoute>[];
export function preferRoute<T extends { stages: readonly { participantId: string }[] }>(options: {
  current: T | null; ranked: readonly (RankedRoute & T)[]; active: boolean; margin: number }): T | RankedRoute | null;
export interface RouteSelectionRecord {
  schema: 'reploid.route-selection/v1'; policy: RouteCostPolicy; reason: string; decidedAt: number;
  workload: { promptTokens: number; expectedTokens: number }; considered: number;
  chosen: (Omit<RankedRoute, 'stages' | 'inputs'> & { inputs: RankedRoute['inputs'] }) | null;
  alternatives: Omit<RankedRoute, 'stages' | 'inputs'>[];
}
export function routeSelectionRecord(options: { policy: RouteCostPolicy; workload: { promptTokens: number; expectedTokens: number };
  ranked: readonly RankedRoute[]; chosen: RankedRoute | null; reason: string; decidedAt: number; maxRoutes: number }): Readonly<RouteSelectionRecord>;
