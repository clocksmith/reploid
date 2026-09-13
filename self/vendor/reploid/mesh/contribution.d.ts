import type { PeerAdvertisement } from './swarm-coordination.js';
export interface ContributionPolicy { outputPointsPer1k: number; inputPointsPer1k: number; diversityBonus: number; repeatedPairCap: number; minCountedTokens: number; scoreHalfLifeMs: number }
export const DEFAULT_REWARD_POLICY: Readonly<ContributionPolicy>;
export function createContributionSummary(input?: Record<string, unknown>): Record<string, unknown>;
export function deriveContributionDelta(receipt: Record<string, unknown>, policy?: ContributionPolicy): Record<string, unknown>;
export function getPairReceiptCount(history?: Record<string, unknown>[], providerId?: string, consumerId?: string): number;
export function isReceiptEligible(receipt: Record<string, unknown>, history?: Record<string, unknown>[], policy?: ContributionPolicy): boolean;
export function applyReceiptToContribution(contribution: Record<string, unknown>, receipt: Record<string, unknown>, history?: Record<string, unknown>[], policy?: ContributionPolicy): Record<string, unknown>;
export function decayContributionScore(contribution: Record<string, unknown>, now?: number, policy?: ContributionPolicy): number;
export function rankProviderPeers(peers?: PeerAdvertisement[], options?: { now?: number; policy?: ContributionPolicy }): (PeerAdvertisement & { decayedScore: number })[];
declare const api: Record<string, unknown>;
export default api;
