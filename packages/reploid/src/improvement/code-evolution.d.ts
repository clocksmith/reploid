import type { ImprovementLedger } from './episodes.js';
export interface EvolutionTarget { id: string; description: string; code: string; tests: Array<{input: unknown; expected?: unknown; throws?: boolean}> }
export interface ToolVersion { id: string; description: string; code: string; generationId: string; episodeId: string | null }
export interface ToolCandidate {
  id: string; targetId: string; taskId: string; code: string; reason: string; generationId: string;
  baselineGeneration: string; createdAt: string; error: string | null;
  origin?: {kind: 'candidate-file' | 'peer-transfer'; sourceHash: string; transport?: ToolOfferProvenance};
  status: 'evaluating' | 'awaiting-approval' | 'rejected' | 'failed' | 'cancelled' | 'adopted' | 'rolled-back';
  evaluation?: {baselinePassed: number; candidatePassed: number; total: number; regressions: number[]; suiteHash: string; candidateHash: string; baselineHash: string; contractHash: string};
}
/** Code transfer only: neither authorship nor evaluation/adoption authority. */
export interface ToolOffer { schema: 'reploid.tool-offer/v1'; targetId: string; code: string; reason: string; codeHash: string }
export interface ToolOfferProvenance { transferId: string; sender: string; recipient: string; roomId: string; envelopeHash: string; receivedAt: number; targetContract: string }
export function createCodeEvolution(options: {
  targets: EvolutionTarget[]; policy: {maxCodeCharacters: number; maxCandidates: number; offers?: {maxBytes: number; maxReasonCharacters: number}; [key: string]: unknown};
  ports: {ledger: ImprovementLedger; load(): Promise<unknown>; save(state: unknown): Promise<void>;
    lock<T>(operation: () => Promise<T>): Promise<T>;
    /** Only exceptions thrown by candidate code carry candidateException: true. Timeouts and host failures must not. */
    execute(code: string, input: unknown, control: {signal?: AbortSignal}): Promise<unknown>;
    verify(code: string, signal?: AbortSignal): Promise<{passed: boolean; errors?: unknown[]}>;
    writeEvidence(path: string, value: unknown): Promise<void>; authorize(request: {action: string; candidateId?: string; targetId?: string; sourceHash?: string; accepted?: boolean}): Promise<boolean>;
    onChange?(): void;
  }
}): {
  readonly offerLimits: Readonly<{maxBytes: number; maxReasonCharacters: number}> | null;
  describeContract(id: string): Promise<string>;
  describe(): Promise<ToolVersion[]>; list(): Promise<ToolCandidate[]>;
  run(id: string, input: unknown, options?: {signal?: AbortSignal; versions?: ToolVersion[]}): Promise<unknown>;
  propose(candidate: {targetId: string; code: string; reason: string; baselineGeneration: string; taskId: string;
    generator: {implementation: string; model: unknown; instruction: string}}, control?: {signal?: AbortSignal}): Promise<ToolCandidate>;
  decide(id: string, accepted: boolean): Promise<ToolCandidate>; rollback(id: string): Promise<ToolCandidate>;
  export(id: string): Promise<{candidate: unknown; episode: unknown; events: unknown[]}>;
  exportOffer(id: string): Promise<ToolOffer>;
  inspectOffer(text: string): Promise<ToolOffer & {baselineGeneration: string; sourceHash: string}>;
  importOffer(text: string, control: {baselineGeneration: string; signal?: AbortSignal; provenance?: ToolOfferProvenance}): Promise<ToolCandidate>;
};
