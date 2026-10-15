export const ROUTE_ENVELOPE_POLICY_SCHEMA: 'reploid.route-envelope-policy/v1';
export interface RouteEnvelopeCell { maxConcurrency: number; maxPromptTokens: number; maxAnswerTokens: number }
export interface RouteEnvelopePolicy {
  schema: 'reploid.route-envelope-policy/v1';
  /** What applies to a route the policy does not declare. */
  undeclaredRoutes: 'existing-limits' | 'refuse';
  routes: Array<{ modelIdentity: string; planId: string; evidence: string; cells: RouteEnvelopeCell[] }>;
}
export function validateRouteEnvelopePolicy(policy: unknown): Readonly<RouteEnvelopePolicy>;
export const ROUTE_ENVELOPE_POLICY: Readonly<RouteEnvelopePolicy>;
export interface RouteEnvelopeAdmission {
  /** The attempt's answer allowance: its own bound, capped by the declared cell. */
  answerTokens: number;
  envelope: null | { concurrency: number; promptTokens: number; maxAnswerTokens: number; evidence: string };
}
export interface RouteEnvelope {
  readonly declared: boolean;
  /** Throws WORKLOAD_OUTSIDE_ENVELOPE before anything reaches the route's stages. */
  admit(input: { attemptId: string; promptTokens: number; answerTokens: number; explicit: boolean }): RouteEnvelopeAdmission;
  release(attemptId: string): void;
  getState(): { declared: boolean; running: number };
}
export function createRouteEnvelope(options: { policy: RouteEnvelopePolicy; route: { modelIdentity: string; planId: string } }): RouteEnvelope;
