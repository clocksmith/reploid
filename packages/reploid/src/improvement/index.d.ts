export * from './episodes.js';
export { default as ImprovementEpisodeLedger } from './episodes.js';
import type { ImprovementLedgerPorts, ImprovementLedger } from './episodes.js';
export function createImprovementLedger(ports: ImprovementLedgerPorts): ImprovementLedger;

export type ImprovementDecision =
  | { status: 'rejected' | 'inconclusive'; candidateId: string; evaluatorId: string; evidenceDigests: readonly string[] }
  | { status: 'approved'; candidateId: string; evaluatorId: string; approvalId: string; baselineId: string; evidenceDigests: readonly string[] }
  | { status: 'adopted' | 'rolled-back'; candidateId: string; approvalId: string; activationId: string; rollbackTarget: string };
