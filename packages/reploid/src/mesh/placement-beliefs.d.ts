export interface PlacementBeliefPolicy {
  readonly schema: 'reploid.placement-belief-policy/v1';
  readonly id: string;
  /** Host-defined, versioned workload population and observation classification. */
  readonly cohortId: string;
  readonly maxObservations: number;
  readonly maxAgeMs: number;
  readonly completionValue: number;
  readonly timeCostPerMs: number;
  /** Same units as completionValue and totalCost; time is charged separately. */
  readonly costUnit: string;
  readonly outcomes: readonly { readonly id: string; readonly prior: number; readonly completed: boolean;
    readonly latencyMs: number; readonly totalCost: number }[];
}
export interface PlacementObservation {
  readonly evidenceId: string;
  readonly dependencyId: string;
  readonly providerId: string;
  readonly contextId: string;
  readonly observedAt: number;
  readonly outcomeId: string | null;
}
export interface PlacementBeliefInput {
  readonly policy: PlacementBeliefPolicy;
  readonly candidates: readonly { readonly providerId: string; readonly contextId: string }[];
  readonly observations: readonly PlacementObservation[];
  readonly now: number;
}
export interface PlacementBeliefProjection {
  readonly schema: 'reploid.placement-beliefs/v1';
  readonly policy: PlacementBeliefPolicy;
  readonly selectedAt: number;
  readonly candidates: readonly {
    readonly providerId: string; readonly contextId: string; readonly evidenceIds: readonly string[];
    readonly posterior: readonly { readonly outcomeId: string; readonly alpha: number;
      readonly probability: number; readonly probabilityVariance: number }[];
    readonly completionProbability: number; readonly expectedLatencyMs: number;
    readonly expectedTotalCost: number; readonly expectedUtility: number; readonly utilityVariance: number;
  }[];
  readonly ignored: readonly { readonly evidenceId: string; readonly reason: string }[];
}
export function resolvePlacementBeliefPolicy(input: PlacementBeliefPolicy): PlacementBeliefPolicy;
export function projectPlacementBeliefs(input: PlacementBeliefInput): PlacementBeliefProjection;
