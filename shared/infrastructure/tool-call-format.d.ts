import type { ToolChoice, ToolDefinition } from './output-constraint.js';

/** The part of `reploid.generation-settings/v1` this module reads. */
export interface ToolSettings { tools?: readonly ToolDefinition[]; toolChoice?: ToolChoice }
export interface ToolCall { name: string; arguments: Record<string, unknown> }
export type ConversationMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ReadonlyArray<ToolCall & { id: string }> }
  | { role: 'tool'; toolCallId: string; content: string };
export interface PlainMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ParsedToolOutput {
  /** Content outside call wrappers, trimmed. */
  text: string;
  /** Whole, declared and valid calls only. */
  toolCalls: ToolCall[];
  /** False when the output stops inside a call, or before a required one has begun. */
  complete: boolean;
  /** The first rejected whole call, or a missing required call. */
  error: string | null;
}

export declare function canonicalJson(value: unknown): string;
export declare function renderToolConversation(messages: readonly ConversationMessage[], settings: ToolSettings | null | undefined): PlainMessage[];
export declare function parseToolCallOutput(content: string, settings: ToolSettings | null | undefined): ParsedToolOutput;
export declare function toolCallId(requestId: string, index: number): string;
