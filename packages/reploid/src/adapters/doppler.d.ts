import type { DopplerRuntimeSession, RuntimePorts } from 'doppler-gpu';
import type { ResolvedConfig } from '../config/index.js';
import type { GenerationProvider, Message, Closable } from '../index.js';
export interface DopplerProvider extends GenerationProvider, Closable { readonly contract: Readonly<Record<string, unknown>> }
export interface DopplerAdapterOptions {
  config: ResolvedConfig; session: DopplerRuntimeSession; ownership: 'owned' | 'borrowed';
  toGenerationRequest(messages: Message[], contract: Readonly<Record<string, unknown>>): Promise<Parameters<DopplerRuntimeSession['generateText']>[0]> | Parameters<DopplerRuntimeSession['generateText']>[0];
}
export function createDopplerProvider(options: DopplerAdapterOptions): DopplerProvider;
export function openDopplerProvider(options: {
  config: ResolvedConfig; capsule: Parameters<import('doppler-gpu').DopplerRuntime['openCapsule']>[0];
  runtimePorts: RuntimePorts; sessionOptions?: Parameters<import('doppler-gpu').DopplerRuntime['openCapsule']>[1];
  toGenerationRequest: DopplerAdapterOptions['toGenerationRequest'];
}): Promise<DopplerProvider>;
