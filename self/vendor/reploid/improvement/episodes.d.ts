import type { Vfs } from '../artifacts/store.js';
import type { SigningIdentity } from '../artifacts/identity.js';
export const IMPROVEMENT_EPISODE_SCHEMA: 'rsi.improvement-episode/v1';
export const IMPROVEMENT_EVENT_SCHEMA: 'rsi.improvement-episode-event/v1';
export const ALGORITHM_MANIFEST_SCHEMA: 'rsi.algorithm-manifest/v1';
export const IMPROVEMENT_EPISODE_ROOT: string, ALGORITHM_REGISTRY_PATH: string;
export type EvidenceRecord = Record<string, unknown>;
export interface Integrity { valid: boolean; reasons: string[]; [key: string]: unknown }
export interface PromotionReadiness { ready: boolean; reasons: string[] }
export interface ImprovementLedgerPorts {
  VFS: Pick<Vfs, 'read'|'write'|'exists'>; identityBundle?: SigningIdentity;
  getIdentity?: (options: { cryptoApi: Crypto }) => Promise<SigningIdentity>;
  cryptoApi?: Crypto; Utils?: { logger?: Record<string, (...values: unknown[]) => void> };
  EventBus?: { emit(event: string, payload: unknown): void };
  AuditLogger?: Record<string, unknown>;
}
export interface ImprovementLedger {
  begin(input: EvidenceRecord): Promise<EvidenceRecord>;
  getEpisode(episodeId: string): Promise<EvidenceRecord | null>;
  listEpisodes(filter?: EvidenceRecord): Promise<EvidenceRecord[]>;
  proposeCandidate(episodeId: string, candidate: EvidenceRecord): Promise<EvidenceRecord>;
  readEvents(episodeId: string): Promise<EvidenceRecord[]>;
  recordComparison(episodeId: string, input: EvidenceRecord): Promise<EvidenceRecord>;
  recordDecision(episodeId: string, input: EvidenceRecord): Promise<EvidenceRecord>;
  recordDiagnosis(episodeId: string, input: EvidenceRecord): Promise<EvidenceRecord>;
  recordEffect(episodeId: string, input: EvidenceRecord): Promise<EvidenceRecord>;
  recordEvaluation(episodeId: string, input: EvidenceRecord): Promise<EvidenceRecord>;
  recordExecution(episodeId: string, input: EvidenceRecord): Promise<EvidenceRecord>;
  recordNegativeEvidence(episodeId: string, input: EvidenceRecord): Promise<EvidenceRecord>;
  recordOutcome(episodeId: string, input: EvidenceRecord): Promise<EvidenceRecord>;
  recordReopening(episodeId: string, input: EvidenceRecord): Promise<EvidenceRecord>;
  recordReflection(episodeId: string, input: EvidenceRecord): Promise<EvidenceRecord>;
  recordReview(episodeId: string, input: EvidenceRecord): Promise<EvidenceRecord>;
  recordRollback(episodeId: string, input: EvidenceRecord): Promise<EvidenceRecord>;
  recordVerification(episodeId: string, input: EvidenceRecord): Promise<EvidenceRecord>;
  registerAlgorithm(input: EvidenceRecord): Promise<EvidenceRecord>;
  requestPromotion(episodeId: string, input?: EvidenceRecord): Promise<EvidenceRecord>;
  verifyEpisode(episodeId: string): Promise<Integrity>;
  assessPromotionReadiness: typeof assessPromotionReadiness;
  pathsForEpisode(episodeId: string): Record<string, string>;
}
export function canonicalJson(value: unknown): string;
export function hashImprovementValue(value: unknown, cryptoApi?: Crypto): Promise<string>;
export function validateMetricDefinition(value: EvidenceRecord): EvidenceRecord;
export function validateAlgorithmManifest(value: EvidenceRecord): EvidenceRecord;
export function validateHypothesisReflection(value: EvidenceRecord): EvidenceRecord;
export function verifyImprovementEvents(events: EvidenceRecord[], cryptoApi?: Crypto): Promise<Integrity>;
export function assessPromotionReadiness(episode: EvidenceRecord | null): PromotionReadiness;
export function validateImprovementEpisodePromotionEvidence(evidence: EvidenceRecord, ports?: { VFS?: ImprovementLedgerPorts['VFS']; cryptoApi?: Crypto }): Promise<{ required: boolean; ok: boolean; reasons: string[] }>;
declare const ledger: { metadata: Readonly<Record<string, unknown>>; factory(ports: ImprovementLedgerPorts): ImprovementLedger };
export default ledger;
