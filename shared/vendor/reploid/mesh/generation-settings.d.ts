import type { Json } from '../config/index.js';
export const GENERATION_SETTINGS_SCHEMA: 'reploid.generation-settings/v1';
export const EFFECTIVE_REQUEST_SCHEMA: 'reploid.effective-request/v1';
export interface GenerationTool { name: string; description: string; parameters: { [key: string]: Json } }
export interface GenerationSettings {
  schema: 'reploid.generation-settings/v1';
  maxOutputTokens: number | null;
  tools: GenerationTool[];
  toolChoice: 'none' | 'auto' | 'required' | { name: string };
  outputSchema: { [key: string]: Json } | null;
  thinking: null | 'on' | 'off';
  reversePrompt?: { schema: 'reploid.reverse-prompt/v1'; backendIdentityHash: string };
}
export type GenerationSettingsInput = Partial<Omit<GenerationSettings, 'tools'>>
  & { tools?: Array<{ name: string; description?: string; parameters: { [key: string]: Json } }> };
export interface GenerationSettingsCapability {
  schema: 'reploid.generation-settings/v1'; maxOutputTokens: boolean; tools: boolean; outputSchema: boolean; thinking: boolean;
  reversePromptBackends?: readonly string[];
}
export interface GenerationSettingsOptions { assertSchema?(schema: { [key: string]: Json }, path: string): void }
export const GENERATION_SETTINGS_CAPABILITY: Readonly<GenerationSettingsCapability>;
export function normalizeGenerationSettings(value: undefined, options?: GenerationSettingsOptions): undefined;
export function normalizeGenerationSettings(value: GenerationSettingsInput, options?: GenerationSettingsOptions): Readonly<GenerationSettings>;
export function normalizeGenerationSettings(value: GenerationSettingsInput | undefined, options?: GenerationSettingsOptions): Readonly<GenerationSettings> | undefined;
export function isCanonicalGenerationSettings(value: unknown, options?: GenerationSettingsOptions): boolean;
export function effectiveRequestDigest(request: { modelIdentity: string; adapterIdentities: string[]; messages: unknown[];
  settings: GenerationSettingsInput }): Promise<string>;
export function normalizeGenerationSettingsCapability(value: unknown): Readonly<GenerationSettingsCapability> | null;
export function intersectGenerationSettingsCapabilities(capabilities: unknown[]): Readonly<GenerationSettingsCapability> | null;
export function unionGenerationSettingsCapabilities(capabilities: unknown[]): Readonly<GenerationSettingsCapability> | null;
export function assertSettingsSupported(capability: unknown, settings: GenerationSettingsInput | undefined): void;
