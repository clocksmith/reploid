// Synthetic outcome classification and costs. No physical performance claim.
export const placementBeliefPolicy = {
  schema: 'reploid.placement-belief-policy/v1', id: 'test-placement-v1', cohortId: 'public-small-v1',
  maxObservations: 100, maxAgeMs: 60000, completionValue: 100, timeCostPerMs: 0.01, costUnit: 'task-utility',
  outcomes: [
    { id: 'fast', prior: 1, completed: true, latencyMs: 100, totalCost: 1 },
    { id: 'slow', prior: 1, completed: true, latencyMs: 1000, totalCost: 20 },
    { id: 'failed', prior: 1, completed: false, latencyMs: 2000, totalCost: 30 }
  ]
};
