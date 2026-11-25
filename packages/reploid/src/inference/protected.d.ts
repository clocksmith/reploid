import type { ProtectedPolicy, FrameChannel, RequesterKeyHolder, ProtectedJournal, SigningIdentity, TrapRequest } from '../mesh/protected-generation.js';
import type { InferenceRoute } from './contract.js';
export { PROTECTED_PROTOCOL, PROTECTED_BACKEND } from '../mesh/protected-generation.js';
export { protectedError } from '../mesh/protected-generation.js';

/** Never `available: true` in this build. */
export declare const PROTECTED_EXECUTION_STATUS: Readonly<{ available: false; reason: 'awaiting independent security review' }>;
export declare const PROTECTED_METADATA: readonly ['model-id', 'timing', 'length'];
export interface ProtectedDisclosures {
  contentReadableBy: { requesterDevice: true; participants: string[]; selection: 'all'; target?: true }; executorsReadContent: boolean;
  confidentiality: { status: 'none' | 'target-not-established'; reason: string };
  metadata: Array<'model-id' | 'timing' | 'length'>; computedBy: string[]; leaks: string[];
  trapOracle: { learns: string[]; trusted: string } | null;
  review: { available: false; reason: string }; statement: string;
}
export declare function protectedDisclosures(route: InferenceRoute): ProtectedDisclosures;
export interface ProtectedExecutionPorts {
  policy: ProtectedPolicy;
  discover(options: { signal?: AbortSignal; model: unknown }): Promise<Array<{ endpoint: unknown; advertisement: unknown }>>;
  connect(endpoint: unknown, options: { signal?: AbortSignal }): Promise<FrameChannel>;
  openCrypto(options: { parameterSet: { id: string; digest: string; insecureDevelopment: boolean }; signal?: AbortSignal }): Promise<RequesterKeyHolder>;
  /** Required when a pinned circuit uses a trap oracle: deliver the request, return the oracle's envelope. */
  requestTraps?: ((options: { endpoint: string; request: TrapRequest; signal?: AbortSignal }) => Promise<unknown>) | null;
  failureStore?: FailureStore | null;
  identity?: SigningIdentity | null; journal?: ProtectedJournal; randomInt?: (n: number) => number; now?: () => number; timeoutMs?: number;
  /** Required, like createInference's flag: without it resolve and execute refuse. */
  unreviewedProtectedExecution?: boolean;
}
export interface ProtectedExecution {
  kind: 'reploid.protected-execution/v1'; protocol: string; journal: ProtectedJournal;
  resolve(request: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  execute(input: unknown): Promise<unknown>;
  detectionProbability(tampered?: number): number;
}
export interface FailureStore {
  list(): Promise<Array<{ evaluator: string; at: number; code: string }>>;
  record(item: { evaluator: string; at: number; code: string }): Promise<void>;
}
export declare function createMemoryFailureStore(): FailureStore;
export declare function createProtectedExecution(ports: ProtectedExecutionPorts): ProtectedExecution;
export declare function protectedEvidence(input: { plan: unknown; admitted: unknown; evidence?: unknown; error?: unknown }): {
  confidentiality: Record<string, unknown>; integrity: Record<string, unknown>;
};
