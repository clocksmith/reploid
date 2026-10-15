/** Model types are inferred from the explicitly injected doppler-gpu/partitions
 * module; this owner defines only conversation transaction requirements.
 * Canonical records need Doppler's validators; ordinary ordered records need only
 * its metadataDigest. */
import type { OrderedPublicationAttempt, OrderedGenerationBounds, OrderedCursor, OrderedPublication }
  from '../mesh/partitions/partition-ordered-publication.js';
export interface PublicationAttempt {
  attemptId: string; coordinatorEpoch: string; publisherEpoch: string; generationId: string;
  stages: readonly { stageId: string }[];
}
export interface PublicationReceipt {
  schema: 'reploid.publication-receipt/v1'; conversationId: string; writerEpoch: string; index: number;
  coordinatorEpoch: string; attemptId: string; sequence: number; publicationDigest: string; receiptDigest: string;
}
export interface TransactionalChatStore {
  schema: 'reploid.transactional-chat-store/v1';
  read(key: string): Promise<unknown>;
  transact<State, Result>(key: string, reducer: (state: State | null) => { state: State; result: Result }): Promise<Result>;
}
export interface PublicationEnvelope<Cursor, Ack> {
  schema: string; publicationDigest: string; attemptId: string; coordinatorEpoch: string; sequence: number;
  previousPublicationDigest: string | null; successor: Cursor; acknowledgments: readonly Ack[];
}
export type AdmissionEnvelope = Omit<PublicationEnvelope<never, never>, 'successor' | 'acknowledgments'>;
export interface PublicationHistory<Attempt, Policy, Cursor, Publication> {
  schema: 'reploid.publication-history/v1'; writerEpoch: string | null; head: string | null;
  attempts: Array<{ identity: Attempt; generationPolicy: Policy; executionIdentity: string; vocabSize: number;
    deadlineAt: number; requireCommitEvidence?: true;
    /** Ordered attempts: the declared window of computed steps that may be uncommitted when the writer stops. */
    persistence?: { maxUnsavedSteps: number; maxUnsavedMs: number }; digest: string; status: 'live' | 'interrupted' | 'cancelled' | 'completed'; nextSequence: number; cursor: Cursor | null }>;
  records: Array<{ publication: Publication; receipt: PublicationReceipt; evidence?: readonly unknown[]; evidenceDigest?: string }>;
}
export function createConversationPublication<Attempt extends PublicationAttempt, Policy,
  Cursor extends { terminal: boolean }, Ack extends { stageId: string }, Publication extends PublicationEnvelope<Cursor, Ack>,
  Admission extends AdmissionEnvelope>(
  options: {
    conversationId: string; writerEpoch: string; store: TransactionalChatStore;
    doppler: {
      metadataDigest(schema: string, body: unknown): string;
      /** Required only when a canonical attempt or record is admitted or verified. */
      validateResidentAttemptIdentity?(input: unknown): Attempt;
      canonicalGenerationIdentity?(policy: Policy, executionIdentity: string, vocabSize: number): { policy: Policy; generationId: string };
      validateExecutionPublication?(input: unknown, attempt: Attempt, policy: Policy, vocabSize: number, base: Cursor | null): Publication;
      validateAdmissionPublication?(input: unknown, attempt: Attempt, policy: Policy, vocabSize: number): Admission;
    };
    authenticateCommit(ack: Ack, stage: Attempt['stages'][number], attempt: Attempt, evidence?: unknown): Promise<boolean>;
    /** Require exact signed stage evidence in the same transaction as output. Persisted admission prevents restart downgrade. */
    requireCommitEvidence?: boolean;
    authorize(scope: { conversationId: string; writerEpoch: string; action: 'writer'|'admit'|'publish'|'cancel'|'read'|'replay'; attempt: Attempt | null }): boolean;
    policy?: { maxAttempts: number; maxPublications: number;
      /** Recorded on each ordered attempt; maxUnsavedSteps 0 declares per-step commit. */
      persistence: { maxUnsavedSteps: number; maxUnsavedMs: number } }; now?: () => number;
  }): {
    readonly requiresCommitEvidence: boolean;
    claimWriter(expectedEpoch: string | null): Promise<{ writerEpoch: string; head: string | null }>;
    admitAttempt(input: { identity: Attempt; generationPolicy: Policy; executionIdentity: string; vocabSize: number; deadlineAt: number }):
      Promise<WriterHistory<Attempt, Policy, Cursor, Publication | Admission>['attempts'][number]>;
    /** Ordinary ordered route: executionIdentity is the attempt's Doppler generation digest. */
    admitAttempt(input: { identity: OrderedPublicationAttempt; generationPolicy: OrderedGenerationBounds; executionIdentity: string;
      vocabSize: number; deadlineAt: number }): Promise<WriterHistory<Attempt, Policy, Cursor, Publication | Admission>['attempts'][number]>;
    publish(input: Publication | Admission | OrderedPublication, options?: { evidence?: readonly unknown[] }): Promise<PublicationReceipt>;
    /** Consecutive records of one attempt, each checked as by publish, committed in one transaction (all or none). */
    publishBatch(inputs: readonly (Publication | Admission | OrderedPublication)[], options?: { evidence?: readonly (readonly unknown[])[] }): Promise<PublicationReceipt[]>;
    cancel(attemptId: string, coordinatorEpoch: string): Promise<{ status: string; head: string | null }>;
    reconcile(): Promise<WriterHistory<Attempt, Policy, Cursor, Publication | Admission>>;
    readPublished(afterIndex: number): Promise<WriterHistory<Attempt, Policy, Cursor, Publication | Admission>['records']>;
  };
/** One conversation's history holds canonical and ordinary ordered attempts. */
export type WriterHistory<Attempt, Policy, Cursor, Publication> = PublicationHistory<Attempt | OrderedPublicationAttempt,
  Policy | OrderedGenerationBounds, Cursor | OrderedCursor, Publication | OrderedPublication>;
