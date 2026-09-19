import type { Configuration, DeepReadonly, Json } from '../config/index.js';
export interface ToolCall { name: string; args?: Record<string, Json>; id?: string | null; after?: string[]; error?: unknown }
export interface ToolAuthorization { action: 'tool.execute'; name: string; args: Record<string, Json>; instanceId?: string }
export interface ToolRequest {
  retry?: { maxRetries: number; delayMs: number };
  call: ToolCall; policy: DeepReadonly<Configuration>; instanceId?: string;
  listToolNames?: () => string[];
  authorize?: (request: ToolAuthorization) => boolean | Promise<boolean>;
  execute(name: string, args: Record<string, Json>, control: { signal: AbortSignal }): unknown | Promise<unknown>;
}
export interface ProviderResponse { content?: string; raw?: string; toolCalls?: ToolCall[] }
export type ExecutionEventType = 'attempt.started' | 'attempt.settled' | 'attempt.cancelled'
  | 'provider.started' | 'provider.completed' | 'provider.failed' | 'provider.cancelled'
  | 'tool.started' | 'tool.completed' | 'tool.failed' | 'tool.denied' | 'tool.cancelled'
  | 'response.interpreted' | 'retry.scheduled' | 'retry.ready';
export interface ExecutionEvent { sequence: number; type: ExecutionEventType; [key: string]: Json }
