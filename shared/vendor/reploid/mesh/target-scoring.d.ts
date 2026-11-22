import type { SwarmTransport } from '../transport/swarm.js';

export const TARGET_SCORE_REQUEST: 'reploid:target-score-request';
export const TARGET_SCORE_RESULT: 'reploid:target-score-result';
export const TARGET_SCORE_SCHEMA: 'reploid.target-score/v1';
export const MAX_TARGET_CHARACTERS: number;

export interface TargetScoreRecord {
  schema: 'reploid.target-score/v1';
  receiptId: string; provider: string; consumer: string; modelIdentity: string;
  inputDigest: string; outputDigest: string; targetDigest: string;
  tokenCount: number; totalLogProbHundredths: number; scoredAt: number;
  providerSignature: string; providerKey: JsonWebKey;
}

type ScoringTransport = Required<Pick<SwarmTransport, 'getPeerBinding' | 'onMessage' | 'sendToPeer'>>;

export function signTargetScore(fields: Omit<TargetScoreRecord, 'schema' | 'providerSignature' | 'providerKey'>,
  bundle: { publicJwk: JsonWebKey; privateJwk: JsonWebKey }, cryptoApi?: Crypto): Promise<TargetScoreRecord>;
export function verifyTargetScore(record: unknown, cryptoApi?: Crypto): Promise<boolean>;
export function attachTargetScoring(options: {
  transport: ScoringTransport;
  identity: { peerId: string; publicJwk: JsonWebKey; privateJwk: JsonWebKey };
  verifyPeer(peerId: string, signal?: AbortSignal): Promise<string | null>;
  currentPeer(peerId: string): string | null;
  score(request: { messages: unknown[]; target: string; signal: AbortSignal }): Promise<{ modelIdentity: string; tokenCount: number; roundedTotalLogProb: number }>;
  maxReceiptAgeMs?: number;
  now?: () => number;
}): void;
export function requestTargetScore(options: {
  transport: ScoringTransport;
  verifyPeer(peerId: string, signal?: AbortSignal): Promise<string | null>;
  currentPeer(peerId: string): string | null;
  providerPeer: string;
  providerParticipantId: string;
  receipt: Record<string, unknown>;
  messages: unknown[];
  target: string;
  signal?: AbortSignal;
}): Promise<TargetScoreRecord>;
