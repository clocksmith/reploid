export interface RouteObservation {
  planId: string; participantId: string; index: number; at: number; samples: number;
  decodeMs: number | null; transferMs: number | null; prefillMsPerToken: number | null;
}
export interface RouteObservations {
  /** Folds one completed attempt's ordered phases (partition-summary.js) into per-stage estimates; returns stages recorded. */
  record(input: { planId: string; route: { stages: readonly { index: number; participantId: string }[] };
    phases: Record<string, any> | null | undefined; at: number }): number;
  get(planId: string, participantId: string, index: number): RouteObservation | null;
  snapshot(): RouteObservation[];
}
export function createRouteObservations(options: { maxEntries: number; smoothing: number }): RouteObservations;
export interface RankingCandidate {
  index: number; participantId: string;
  capacity?: { active?: number; availableSlots?: number; closed?: boolean };
  /** Admitted allocation headroom reported for this candidate; omitted means not reported. */
  memory?: { availableBytes: number } | null;
  [key: string]: unknown;
}
export interface RankedRoute {
  stages: RankingCandidate[]; cost: number | null; measured: boolean; stageCosts: (number | null)[];
}
export function rankPartitionRoutes(options: { planId: string; candidates: RankingCandidate[][];
  observations: Pick<RouteObservations, 'get'>;
  workload: { promptTokens: number; expectedTokens: number; allocationBytes: number };
  limits: { maxParticipants: number; maxRoutes: number; maxSelectionSteps: number } }): readonly Readonly<RankedRoute>[];
export function preferRoute<T extends { stages: readonly { participantId: string }[] }>(options: {
  current: T | null; ranked: readonly (RankedRoute & T)[]; active: boolean; margin: number }): T | RankedRoute | null;
