export interface PartitionGenerationRequest {schema:'reploid.partition-generation-request/v1';maxOutputTokens:number;usage:'raw-model-tokens/v1'}
/** Actual model template tokens and raw selected output tokens, including terminal tokens. */
export interface PartitionTokenUsage {schema:'raw-model-tokens/v1';inputTokens:number;outputTokens:number}
export const TEXT_GENERATION_CAPABILITY:Readonly<{schema:'reploid.text-generation/v1';usage:'raw-model-tokens/v1'}>;
export function generationRequest(value:unknown):Readonly<PartitionGenerationRequest>|undefined;
export function requireGenerationCapability(model:unknown,value:unknown,canonical?:boolean):Readonly<PartitionGenerationRequest>|undefined;
export function boundedGeneration<T extends {maxTokens:number}>(settings:T,requested:unknown):T;
export function tokenUsage(inputTokens:number,outputTokens:number,requested:unknown):Readonly<PartitionTokenUsage>;
