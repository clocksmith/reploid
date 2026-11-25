import type { InferenceRoute } from '../contract.js';
import type { AttestedPolicy, AttestationSummary, VerifierHooks } from './verifier.js';
import type { FrameChannel } from './session.js';
export { ATTESTED_PROTOCOL, ATTESTED_BACKEND } from './verifier.js';

export declare const ATTESTED_OFFER_SCHEMA: 'reploid.attested-gpu-offer/v1';
/** Never `available: true` in this build. */
export declare const ATTESTED_EXECUTION_STATUS: Readonly<{ available: false; reason: string }>;
export declare const ATTESTED_METADATA: readonly ['model-id', 'timing', 'length', 'access-patterns'];
export interface TrustBoundary { inside: string[]; outside: string[]; trusted: string[] }
export type AttestedCoverage = 'full-image' | 'boot-chain-only';
/** The boundary of a `full-image` launch. A route's own boundary follows its coverage: see `attestedTrustBoundary`. */
export declare const ATTESTED_TRUST_BOUNDARY: Readonly<TrustBoundary>;
/** The trust boundary for a launch's coverage. Anything other than `full-image` gets the boot-chain-only boundary. */
export declare function attestedTrustBoundary(coverage: AttestedCoverage | string | null | undefined): Readonly<TrustBoundary>;
export declare const ATTESTED_CLAIM: string;
export interface AttestedOffer {
  schema: 'reploid.attested-gpu-offer/v1'; participantId: string; platform: 'amd-sev-snp' | 'intel-tdx'; launchId: string;
  model: { id: string; identity: string }; operator: string; price: { unit: 'noncash-service-credit'; creditsPerOutputToken: number };
}
export interface AttestedDisclosures {
  contentReadableBy: { requesterDevice: true; participants: []; selection: 'one-of';
    attestedEnclave: { participantId: string; platform: string; launchId: string; coverage: AttestedCoverage } };
  executorsReadContent: true; operatorReadsContent: false; metadata: Array<'model-id' | 'timing' | 'length' | 'access-patterns'>; computedBy: string[];
  trustBoundary: TrustBoundary; claim: string; target: { statement: string; status: string }; leaks: string[];
  performance: { claimed: false; reason: string }; review: { available: false; reason: string }; statement: string;
}
export declare function attestedDisclosures(route: InferenceRoute & { attested: { platform: string; launchId: string; coverage?: AttestedCoverage | string } }): AttestedDisclosures;
export interface AttestedCredits {
  reserve(input: { planId: string; requestId: string; model: { id: string; identity: string; adapterIdentities: string[] }; participantId: string; maximum: number; unit: string }): Promise<{ id: string; maximum: number }>;
  settle(input: { reservation: { id: string; maximum: number }; charge: number; outputTokens: number }): Promise<Record<string, unknown>>;
  release(input: { reservation: { id: string; maximum: number } }): Promise<void>;
}
export interface AttestedExecutionPorts {
  policy: AttestedPolicy;
  discover(options: { signal?: AbortSignal; model: unknown }): Promise<Array<{ endpoint: unknown; offer: AttestedOffer }>>;
  connect(endpoint: unknown, options: { signal?: AbortSignal }): Promise<FrameChannel>;
  hooks?: VerifierHooks; credits?: AttestedCredits | null; now?: () => number; timeoutMs?: number; generationTimeoutMs?: number;
  /** Off by default. Without it `resolve` and `execute` refuse with ATTESTED_EXECUTION_UNAVAILABLE. */
  unreviewedAttestedExecution?: boolean;
}
export interface AttestedExecution {
  kind: 'reploid.attested-execution/v1'; protocol: string; policyDigest(): Promise<string>;
  resolve(request: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  execute(input: unknown): Promise<unknown>;
}
export declare function createAttestedExecution(ports: AttestedExecutionPorts): AttestedExecution;
export declare function attestedEvidence(input: { plan: unknown; admitted: unknown; evidence?: { attestation: AttestationSummary; frames: unknown; timing?: unknown } | null }): {
  confidentiality: Record<string, unknown>; integrity: Record<string, unknown>; timing?: unknown;
};
