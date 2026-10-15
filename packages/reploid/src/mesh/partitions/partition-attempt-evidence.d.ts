import type { RouteAttemptBinding } from './partition-contract.js';
/** An Ed25519 or ECDSA P-256 participant public key reduced to its coordinates. */
export type ParticipantPublicJwk = { kty: 'OKP'; crv: 'Ed25519'; x: string } | { kty: 'EC'; crv: 'P-256'; x: string; y: string };

export const STAGE_RECEIPT_SCHEMA: 'reploid.stage-receipt/v1';
export const OUTPUT_ACKNOWLEDGMENT_SCHEMA: 'reploid.output-acknowledgment/v1';
export const OUTPUT_CHAIN_SCHEMA: 'reploid.output-chain/v1';
export const ATTEMPT_EVIDENCE_SCHEMA: 'reploid.attempt-evidence/v1';
export const STAGE_RECEIPT_STATUSES: readonly ['executing', 'settled', 'failed'];

/** One stage's cumulative statement about one charged attempt, signed with its participant identity. */
export interface StageReceiptBody {
  schema: 'reploid.stage-receipt/v1'; reservationId: string; attemptId: string; routeHash: string;
  partitionIndex: number; participantId: string; sequence: number; status: 'executing' | 'settled' | 'failed'; steps: number;
  tokens: { prompt: number | null; processed: number };
  timing: { reservedAt: string | null; firstStepAt: string | null; lastStepAt: string | null; closedAt: string | null };
  /** Final stage only: the hash chain over every step's delta. */
  output: { count: number; chain: string; done: boolean; stopReason: string | null } | null;
  signedAt: string;
}
export type StageReceipt = StageReceiptBody & { publicJwk: ParticipantPublicJwk; signature: string };
/** The requester's statement that it received `count` outputs whose chain is `chain`; count 0 is the charge binding. */
export interface OutputAcknowledgmentBody {
  schema: 'reploid.output-acknowledgment/v1'; reservationId: string; attemptId: string; routeHash: string;
  requesterId: string; count: number; chain: string; signedAt: string;
}
export type OutputAcknowledgment = OutputAcknowledgmentBody & { publicJwk: ParticipantPublicJwk; signature: string };
export interface AcknowledgedOutput { acknowledgment: OutputAcknowledgment; receipt: StageReceipt }
export interface AttemptEvidenceBundle {
  schema: 'reploid.attempt-evidence/v1'; reservationId: string; attemptId: string; identity: RouteAttemptBinding;
  receipts: StageReceipt[]; acknowledged: AcknowledgedOutput | null;
}
export interface AttemptEvidenceSigner {
  readonly participantId: string;
  readonly now: () => number;
  sign<Body extends object>(domain: string, body: Body): Promise<Body & { publicJwk: ParticipantPublicJwk; signature: string }>;
}
export type VerifiedRecord<Body> = { ok: true; body: Body } | { ok: false; problem: string };

export function attemptRouteHash(identity: RouteAttemptBinding): Promise<string>;
export function outputChainGenesis(binding: { reservationId: string; routeHash: string }): Promise<string>;
export function extendOutputChain(previous: string, output: { step: number; delta: string }): Promise<string>;
export function createAttemptEvidenceSigner(options: { identity: { peerId: string; publicJwk: object; privateJwk: object; algorithm?: string };
  now?: () => number }): AttemptEvidenceSigner;
export function verifyStageReceipt(receipt: unknown, options?: { publicJwk?: object | null }): Promise<VerifiedRecord<StageReceiptBody>>;
export function verifyOutputAcknowledgment(acknowledgment: unknown, options?: { publicJwk?: object | null }): Promise<VerifiedRecord<OutputAcknowledgmentBody>>;
export function isChargeBindingShape(charge: unknown, binding: { attemptId: string; requesterId: string }): boolean;
export function checkAttemptEvidenceBundle(bundle: unknown): string | null;
export interface StageReceiptTally {
  readonly reservationId: string; readonly routeHash: string;
  step(step: { step: number; inputTokenCount: number; delta?: string; done?: boolean; stopReason?: string | null }): Promise<StageReceipt | null>;
  acknowledge(pair: AcknowledgedOutput): boolean;
  close(options?: { failed?: boolean }): Promise<StageReceipt | null>;
  evidence(): AttemptEvidenceBundle;
}
export function openStageReceipts(options: { signer: AttemptEvidenceSigner; identity: RouteAttemptBinding; partitionIndex: number;
  charge: OutputAcknowledgment; now?: () => number }): Promise<StageReceiptTally>;
export interface OutputAcknowledgments {
  readonly routeHash: string; readonly charge: OutputAcknowledgment;
  observe(output: { step: number; delta: string; done?: boolean; receipt: StageReceipt | null }): Promise<AcknowledgedOutput | null>;
  state(): Record<string, unknown>;
  evidence(): AttemptEvidenceBundle;
}
export function openOutputAcknowledgments(options: { signer: AttemptEvidenceSigner; identity: RouteAttemptBinding; reservationId: string;
  now?: () => number; restore?: Record<string, unknown> | null }): Promise<OutputAcknowledgments>;
