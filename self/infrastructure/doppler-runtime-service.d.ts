import type { DopplerExecutableSchema } from '../config/doppler-execution-contracts.js';
import type { GENERATION_CONTRACT, GenerationInput, GenerationOptions, ResolvedGenerationOptions } from '../config/doppler-generation-contract.js';
export const DOPPLER_GENERATION_CONTRACT: typeof GENERATION_CONTRACT;
export function validateDopplerGenerationRequest(request: { input: GenerationInput; options: GenerationOptions }): ResolvedGenerationOptions;
export function assertDopplerGenerationContract(session: DopplerManagedSession): void;
export interface DopplerManagedSession {
  readonly schema: string;
  readonly loaded: boolean;
  readonly [key: string]: unknown;
  close?(): void | Promise<void>;
}
export interface DopplerOpenRequest {
  scope?: string;
  source: unknown;
  options?: Readonly<Record<string, unknown>>;
  module?: object | null;
}
export interface ReploidDopplerRuntimeService {
  open(request: DopplerOpenRequest): Promise<DopplerManagedSession>;
  openPack(request: DopplerOpenRequest): Promise<DopplerManagedSession>;
  openCapsule(request: DopplerOpenRequest): Promise<DopplerManagedSession>;
  close(scope?: string): Promise<void>;
  closeAll(): Promise<void>;
  get(scope?: string): DopplerManagedSession | null;
  prepare(module?: object | null, control?: { bindingSchema?: DopplerExecutableSchema | null }): Promise<{ ok: true; version: string | null }>;
  resetModuleForTests(): void;
}
export function createReploidDopplerRuntimeService(options?: {
  loadModule?: () => object | Promise<object>;
  expectedVersion?: string | null;
}): ReploidDopplerRuntimeService;
export const DopplerRuntimeService: ReploidDopplerRuntimeService;
