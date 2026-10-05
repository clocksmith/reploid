import type { DopplerRuntimeSession, RuntimePorts } from 'doppler-gpu';
import type { ResolvedConfig } from '../config/index.js';
import type { GenerationProvider, GenerationResult, Message, Closable } from '../index.js';
type OperationRequest = Parameters<DopplerRuntimeSession['executeOperation']>[0];
type OperationEvent = Exclude<Awaited<ReturnType<ReturnType<DopplerRuntimeSession['executeOperation']>['next']>>['value'], void>;
export type DopplerGenerationResult = GenerationResult & (
  { execution: 'compatibility'; evidence: import('doppler-gpu').GenerationOutput }
  | { execution: 'verified-operation'; evidence: Extract<OperationEvent, { type: 'complete' }> }
);
export interface DopplerProvider extends GenerationProvider, Closable {
  readonly contract: Readonly<Record<string, unknown>>;
  generate(messages: Message[], onUpdate?: ((addition: string) => void | Promise<void>) | null,
    control?: NonNullable<Parameters<DopplerRuntimeSession['executeOperation']>[1]>): Promise<DopplerGenerationResult>;
}
interface DopplerAdapterBase {
  config: ResolvedConfig; session: DopplerRuntimeSession; ownership: 'owned' | 'borrowed';
  /** Public exports from the same installed runtime that created session. Loaded lazily when omitted. */
  runtime?: {
    DOPPLER_VERSION: string; GENERATION_CONTRACT: typeof import('doppler-gpu')['GENERATION_CONTRACT'];
    createCapsuleStreamAccumulator?: (request: OperationRequest) => {
      accept(event: OperationEvent): void; finish(): OperationEvent;
    };
  };
}
export type DopplerAdapterOptions = DopplerAdapterBase & ({
  toOperationRequest(messages: Message[], contract: Readonly<Record<string, unknown>>): Promise<OperationRequest> | OperationRequest;
  toGenerationRequest?: never;
} | {
  /** Legacy completion-only formatter. Adopt toOperationRequest for verified operation streaming. */
  toGenerationRequest(messages: Message[], contract: Readonly<Record<string, unknown>>): Promise<Parameters<DopplerRuntimeSession['generateText']>[0]> | Parameters<DopplerRuntimeSession['generateText']>[0];
  toOperationRequest?: never;
});
export function createDopplerProvider(options: DopplerAdapterOptions): DopplerProvider;
export function openDopplerProvider(options: Pick<DopplerAdapterOptions, 'toGenerationRequest' | 'toOperationRequest'> & {
  config: ResolvedConfig; capsule: Parameters<import('doppler-gpu').DopplerRuntime['openCapsule']>[0];
  runtimePorts: RuntimePorts; sessionOptions?: Parameters<import('doppler-gpu').DopplerRuntime['openCapsule']>[1];
}): Promise<DopplerProvider>;

export type DopplerOperationRequest = Omit<OperationRequest, 'operation'> & {
  operation: { name: OperationRequest['operation']['name'] | 'scoreChoices'; version: 1 };
};
export interface DopplerOperationProvider extends Closable {
  readonly contract: Readonly<Record<string, unknown>>;
  /** Completion evidence is verified before output is returned. */
  execute(request: DopplerOperationRequest, control?: {
    signal?: AbortSignal;
    onPartial?: (event: OperationEvent) => void | Promise<void>;
    adapterArtifactStore?: NonNullable<Parameters<DopplerRuntimeSession['executeOperation']>[1]>['adapterArtifactStore'];
  }): Promise<{ output: unknown; evidence: OperationEvent; model: string; provider: 'doppler' }>;
}
export function createDopplerOperationProvider(options: DopplerAdapterBase & {
  runtime?: DopplerAdapterBase['runtime'] & {
    validateChoiceScoringResult?: (request: Record<string, unknown>, result: unknown) => unknown;
  };
}): DopplerOperationProvider;

export interface ChoiceScoringRequest {
  prompt: string; choices: readonly { id: string; label: string }[]; maxSeqLen: number;
}
export interface ChoiceScoringResult {
  schema: 'doppler.choice-scores/v1'; interpretation: 'next-token-logits'; calibration: null;
  choices: { id: string; label: string; tokenId: number; logit: number }[];
  selectedId: string; promptTokenCount: number;
}
/** Extension for the existing host-supplied mesh operation registry. No grants are added. */
export function createDopplerChoiceScoringAdapter(runtime: {
  CHOICE_SCORING_CONTRACT: { schema: string };
  snapshotChoiceScoringRequest: (request: unknown) => Readonly<ChoiceScoringRequest>;
  validateChoiceScoringResult: (request: ChoiceScoringRequest, output: unknown) => ChoiceScoringResult;
}): {
  definition: Readonly<Record<string, unknown>>;
  implementation: {
    contractVersion: number;
    validateRequest(request: { input: Omit<ChoiceScoringRequest, 'maxSeqLen'>; options: Pick<ChoiceScoringRequest, 'maxSeqLen'> }): void;
    validateOutput(output: unknown, request: { input: Omit<ChoiceScoringRequest, 'maxSeqLen'>; options: Pick<ChoiceScoringRequest, 'maxSeqLen'> }): void;
    compare(output: ChoiceScoringResult, reference: ChoiceScoringResult,
      policy: { absoluteTolerance: number; relativeTolerance: number }): boolean;
  };
};
