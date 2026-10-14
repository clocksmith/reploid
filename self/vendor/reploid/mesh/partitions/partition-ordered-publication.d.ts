import type { PartitionRoute, RouteAttemptBinding } from './partition-contract.js';
import type { PublicationReceipt } from '../../chat/workspace-publication.js';
/** Requester-owned publication of ordinary ordered decoding. Records bind each
 * final-stage step to its route attempt and durable order; ordinary ordered
 * stages sign no commitments, so records carry zero acknowledgments. */
export const ORDERED_PUBLICATION_SCHEMA: 'reploid.ordered-publication/v1';
export const ORDERED_PUBLICATION_ATTEMPT_SCHEMA: 'reploid.ordered-publication-attempt/v1';
export const ORDERED_PUBLICATION_CONTEXT_SCHEMA: 'reploid.ordered-publication-context/v1';
/** Requester-chosen context carried with an ordered input. */
export interface OrderedPublicationContext {
  schema: 'reploid.ordered-publication-context/v1'; publisherEpoch: string; deadlineAt: number;
}
export interface OrderedPublicationAttempt {
  schema: 'reploid.ordered-publication-attempt/v1'; attemptId: string; threadId: string; requesterId: string;
  placementGeneration: number; route: PartitionRoute; coordinatorEpoch: string; publisherEpoch: string; generationDigest: string;
}
export interface OrderedGenerationBounds {
  schema: 'reploid.ordered-generation-bounds/v1'; maxTokens: number; maxOutputCharacters: number;
}
export interface OrderedCursor {
  schema: 'reploid.ordered-cursor/v1'; revision: number; generatedTokenCount: number; nextTokenPosition: number;
  pendingTokenId: number; outputCharacters: number; terminal: boolean; stopReason: string | null;
}
export interface OrderedPublication {
  schema: 'reploid.ordered-publication/v1'; publicationDigest: string; attemptId: string; coordinatorEpoch: string;
  attemptDigest: string; sequence: number; previousPublicationDigest: string | null; tokenPosition: number;
  inputTokenCount: number; tokenId: number; delta: { text: string }; successor: OrderedCursor; acknowledgments: readonly [];
}
export interface OrderedPublicationStep {
  sequence: number; tokenPosition: number; inputTokenCount: number; tokenId: number; delta: string; done: boolean; stopReason: string | null;
}
/** The requester's transaction owner, as a coordinator reaches it. */
export interface OrderedPublicationPort {
  readonly requiresCommitEvidence: boolean;
  reconcile(): Promise<{ head: string | null; attempts: Array<{ identity: { attemptId: string; coordinatorEpoch: string } }> }>;
  admitAttempt(input: { identity: OrderedPublicationAttempt; generationPolicy: OrderedGenerationBounds; executionIdentity: string;
    vocabSize: number; deadlineAt: number }): Promise<unknown>;
  publish(input: OrderedPublication, options: { evidence: readonly [] }): Promise<PublicationReceipt>;
  cancel(attemptId: string, coordinatorEpoch: string): Promise<unknown>;
}
export function validateOrderedPublicationContext(value: unknown): OrderedPublicationContext;
export function validateOrderedPublicationAttempt(value: unknown): OrderedPublicationAttempt;
export function orderedPublicationAttempt(options: { binding: RouteAttemptBinding; coordinatorEpoch: string;
  publisherEpoch: string; generationDigest: string }): OrderedPublicationAttempt;
export function validateOrderedGenerationBounds(value: unknown): OrderedGenerationBounds;
export function orderedGenerationBounds(options: { maxTokens: number; maxOutputCharacters: number }): OrderedGenerationBounds;
export function orderedPublicationRecord(options: { attempt: OrderedPublicationAttempt; bounds: OrderedGenerationBounds;
  vocabSize: number; base: OrderedCursor | null; previousPublicationDigest: string | null;
  metadataDigest(schema: string, body: unknown): string; step: OrderedPublicationStep }): OrderedPublication;
export function validateOrderedPublication(input: unknown, attempt: OrderedPublicationAttempt, bounds: OrderedGenerationBounds,
  vocabSize: number, base: OrderedCursor | null, metadataDigest: (schema: string, body: unknown) => string): OrderedPublication;
