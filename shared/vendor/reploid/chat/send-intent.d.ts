export declare const SEND_INTENT_SCHEMA: 'reploid.send-intent/1';
export declare const SEND_INTENT_TTL_MS: 30000;
export type SendIntentRefusal = 'expired' | 'selection-changed' | 'artifact-mismatch' | 'thread-changed';
export declare const SEND_INTENT_REFUSALS: readonly SendIntentRefusal[];
export interface SendIntentArtifact { identity: string; adapterIdentities: string[] }
export type SendIntentSelection = { mode: 'auto' } | { mode: 'pinned'; artifact: SendIntentArtifact };
export interface SendIntent {
  schema: 'reploid.send-intent/1';
  intentId: string;
  threadId: string | null;
  selection: SendIntentSelection;
  selectionRevision: number;
  createdAt: number;
  expiresAt: number;
}
export declare function sendIntentArtifact(model: unknown): SendIntentArtifact | null;
export declare function validateSendIntent(value: unknown): Readonly<SendIntent>;
export declare function createSendIntent(input: { intentId: string; threadId?: string | null; selection?: SendIntentSelection;
  selectionRevision?: number; createdAt: number }): Readonly<SendIntent>;
export declare function sendIntentPermits(intent: SendIntent, artifact: SendIntentArtifact | null): boolean;
export declare function sendIntentRefusal(intent: SendIntent, check: { now: number; selectionRevision: number;
  artifact: SendIntentArtifact | null; threadId?: string | null }): SendIntentRefusal | null;
