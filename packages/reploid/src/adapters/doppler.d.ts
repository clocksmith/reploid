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
