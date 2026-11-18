export declare const OUTPUT_CONSTRAINT_SCHEMA: 'reploid.output-constraint/v1';
export declare const TOOL_CALL_OPEN: '<tool_call>';
export declare const TOOL_CALL_CLOSE: '</tool_call>';
export declare const SCHEMA_LIMITS: Readonly<{ depth: number; properties: number; enumEntries: number; nodes: number }>;
/** Most whitespace characters accepted at each gap around the wrapper tags. */
export declare const GAP_LIMIT: number;

/** A JSON Schema inside the subset documented in output-constraint.js. */
export type JsonSchema = Readonly<Record<string, unknown>>;
export interface ToolDefinition { name: string; description?: string; parameters: JsonSchema }
export type ToolChoice = 'none' | 'auto' | 'required' | { name: string };
export type ConstraintSpec =
  | { kind: 'tool-call'; tools: readonly ToolDefinition[]; toolChoice?: ToolChoice }
  | { kind: 'json'; schema: JsonSchema };

/** An interned acceptor state: copy by reference, compare with ===, never change. */
export interface ConstraintState { readonly id: number }

export interface OutputConstraint {
  readonly schema: typeof OUTPUT_CONSTRAINT_SCHEMA;
  readonly kind: 'tool-call' | 'json';
  /** `sha256:` digest of `identitySource` when one was supplied or computed, otherwise null. */
  readonly identity: string | null;
  /** Canonical JSON of the constraint; equal sources accept the same output. */
  readonly identitySource: string;
  start(): ConstraintState;
  /** The state after `text`, or null when `text` cannot follow. */
  advance(state: ConstraintState, text: string): ConstraintState | null;
  /** `advance` for one UTF-16 code unit. */
  advanceCode(state: ConstraintState, code: number): ConstraintState | null;
  /** Whether the output may end here. */
  isAccepting(state: ConstraintState): boolean;
  /** Whether any further text is acceptable from here on. */
  isUnconstrained(state: ConstraintState): boolean;
  /** Plain string characters still accepted inside string text, or -1 elsewhere. */
  plainRun(state: ConstraintState): number;
}

export interface SchemaVerdict { valid: boolean; error: string | null }
type CryptoLike = { subtle?: SubtleCrypto } | null | undefined;

export declare function assertSupportedSchema(schema: unknown): void;
export declare function validateAgainstSchema(schema: unknown, value: unknown): SchemaVerdict;
export declare function constraintIdentitySource(spec: ConstraintSpec): string;
export declare function digestConstraintIdentity(specOrSource: ConstraintSpec | string, cryptoApi?: CryptoLike): Promise<string>;
export declare function compileConstraint(spec: ConstraintSpec, options?: { identity?: string | null }): OutputConstraint;
export declare function compileConstraintWithIdentity(spec: ConstraintSpec, cryptoApi?: CryptoLike): Promise<OutputConstraint>;
export declare function logitMaskIdentity(constraint: OutputConstraint): { id: string; contentDigest: string };

/** The tokenizer call the token table relies on: text of ids, special tokens skipped, untrimmed. */
export interface TokenDecoder { decode(ids: number[], skipSpecialTokens?: boolean, trim?: boolean): string }
/** Opaque per-tokenizer token table; build it early with `prepareTokenTable` to move its cost. */
export interface TokenTable { readonly vocabSize: number; readonly known: number }
export declare function prepareTokenTable(tokenizer: TokenDecoder, vocabSize: number): TokenTable;

/** Doppler's `logitMaskFn`: synchronous, edits `logits` in place. */
export type LogitMask = (logits: Float32Array,
  context: { generatedIds: number[]; tokenizer: unknown; vocabSize: number }) => void;
export declare function createLogitMask(options: { constraint: OutputConstraint; endTokenIds: readonly number[] }): LogitMask;
