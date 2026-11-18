import type { ConstraintSpec, LogitMask } from './output-constraint.js';
import type { ConversationMessage, PlainMessage, ToolSettings } from './tool-call-format.js';

export declare const TOOL_CALL_FORMAT: 'reploid.tool-call/hermes-v1';
/** The declared format, or null when the model declares none; throws on an unknown value. */
export declare function modelToolCallFormat(model: { toolCallFormat?: unknown } | null | undefined): typeof TOOL_CALL_FORMAT | null;
export declare function hasToolMessages(messages: unknown): boolean;
/** Null when the settings constrain nothing: no tools, or `toolChoice` 'none'. */
export declare function toolConstraintSpec(settings: ToolSettings | null | undefined): ConstraintSpec | null;
export declare function expectedConstraintIdentity(settings: ToolSettings | null | undefined,
  cryptoApi?: { subtle?: SubtleCrypto } | null): Promise<string | null>;
/** Whether a completed answer is one the agreed tool constraint admits; a requester checks it before countersigning. */
export declare function acceptToolResult(response: { content?: string; completion?: { stopReason?: string } } | null | undefined,
  settings: ToolSettings | null | undefined): boolean;
/** Stop tokens of a loaded Doppler scoped session; throws when it exposes none. */
export declare function sessionEndTokenIds(session: unknown): number[];

export interface PreparedToolRequest {
  /** The input messages, or their plain rendering when tools or tool messages are present. */
  messages: ReadonlyArray<ConversationMessage | PlainMessage>;
  /** Options to add to the Doppler generation call; empty when output is unconstrained. */
  generation: { logitMaskFn?: LogitMask; logitMaskIdentity?: { id: string; contentDigest: string } };
  /** `sha256:` identity of the applied constraint, or null when none was applied. */
  constraintIdentity: string | null;
}
export interface ToolCallEnforcement {
  prepare(messages: readonly ConversationMessage[], settings: ToolSettings | null | undefined,
    ports: { endTokenIds(): readonly number[] }): Promise<PreparedToolRequest>;
}
export declare function createToolCallEnforcement(): ToolCallEnforcement;
