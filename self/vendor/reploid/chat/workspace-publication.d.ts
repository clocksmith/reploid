/** Model types are inferred from the explicitly injected doppler-gpu/partitions
 * module; this owner defines only conversation transaction requirements. */
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
    deadlineAt: number; requireCommitEvidence?: true; digest: string; status: 'live' | 'interrupted' | 'cancelled' | 'completed'; nextSequence: number; cursor: Cursor | null }>;
  records: Array<{ publication: Publication; receipt: PublicationReceipt; evidence?: readonly unknown[]; evidenceDigest?: string }>;
}
export function createConversationPublication<Attempt extends PublicationAttempt, Policy,
  Cursor extends { terminal: boolean }, Ack extends { stageId: string }, Publication extends PublicationEnvelope<Cursor, Ack>,
  Admission extends AdmissionEnvelope>(
  options: {
    conversationId: string; writerEpoch: string; store: TransactionalChatStore;
    doppler: {
      metadataDigest(schema: string, body: unknown): string;
      validateResidentAttemptIdentity(input: unknown): Attempt;
      canonicalGenerationIdentity(policy: Policy, executionIdentity: string, vocabSize: number): { policy: Policy; generationId: string };
      validateExecutionPublication(input: unknown, attempt: Attempt, policy: Policy, vocabSize: number, base: Cursor | null): Publication;
      validateAdmissionPublication(input: unknown, attempt: Attempt, policy: Policy, vocabSize: number): Admission;
    };
    authenticateCommit(ack: Ack, stage: Attempt['stages'][number], attempt: Attempt, evidence?: unknown): Promise<boolean>;
    /** Require exact signed stage evidence in the same transaction as output. Persisted admission prevents restart downgrade. */
    requireCommitEvidence?: boolean;
    authorize(scope: { conversationId: string; writerEpoch: string; action: 'writer'|'admit'|'publish'|'cancel'|'read'|'replay'; attempt: Attempt | null }): boolean;
    policy?: { maxAttempts: number; maxPublications: number }; now?: () => number;
  }): {
    readonly requiresCommitEvidence: boolean;
    claimWriter(expectedEpoch: string | null): Promise<{ writerEpoch: string; head: string | null }>;
    admitAttempt(input: { identity: Attempt; generationPolicy: Policy; executionIdentity: string; vocabSize: number; deadlineAt: number }):
      Promise<PublicationHistory<Attempt, Policy, Cursor, Publication | Admission>['attempts'][number]>;
    publish(input: Publication | Admission, options?: { evidence?: readonly unknown[] }): Promise<PublicationReceipt>;
    cancel(attemptId: string, coordinatorEpoch: string): Promise<{ status: string; head: string | null }>;
    reconcile(): Promise<PublicationHistory<Attempt, Policy, Cursor, Publication | Admission>>;
    readPublished(afterIndex: number): Promise<PublicationHistory<Attempt, Policy, Cursor, Publication | Admission>['records']>;
  };
