/** A class of execution supply: this device, community contributors (peer whole requests or partition stages), or a hosted service. */
export type SupplyClass = 'local' | 'mesh' | 'hosted';
/** One class; `mixed` is more than one; `none` engaged no executor; `unknown` names no recognized executor and is never mesh. */
export type SupplyLabel = SupplyClass | 'mixed' | 'none' | 'unknown';
export type ExecutionPlacement = 'local-webgpu' | 'peer-whole-request' | 'two-device-layer-partition' | 'ordered-layer-partition' | 'hosted-api';
export interface SupplyParticipant {
  /** The participant id from the route/execution record; null for a hosted service or an unidentified local device. */
  participantId: string | null; supply: SupplyClass; role: 'whole-request' | 'stage'; stage: number | null;
  /** The hosted service's name, for hosted participants only. */
  provider?: string;
}
export interface ExecutionSupply {
  supply: SupplyLabel; classes: SupplyClass[]; placement: ExecutionPlacement | string | null; participants: SupplyParticipant[];
  /** Why the record is unknown. */
  reason?: 'invalid-record' | 'incomplete-hosted-record' | 'unrecognized-provider' | 'invalid-route-record' | 'incomplete-peer-record'
    | 'incomplete-partition-record' | 'unrecognized-placement' | 'executor-not-reported';
}
/** Where retrieval ran: an operator's server route, this device, no retrieval, or an undeclared provider. */
export interface RetrievalSupply {
  supply: 'server' | 'device' | 'contributor' | 'none' | 'unknown';
  route?: string | null; provider?: string | null; searchService?: string | null; searchServer?: string | null; outcome?: string | null;
}
export interface AnswerProvenance {
  schema: 'reploid.answer-provenance/v1'; attemptId: string;
  /** This attempt together with its earlier attempts (retry lineage); any unknown part makes it unknown. */
  supply: SupplyLabel; classes: SupplyClass[];
  /** This attempt alone. */
  execution: ExecutionSupply;
  /** Earlier attempts of the same answer through `retryOf`, oldest first. */
  earlierAttempts: Array<{ attemptId: string; status: string | null; supply: SupplyLabel; classes: SupplyClass[] }>;
  retrieval: RetrievalSupply;
}
/** The hosted execution record a hosted executor must report: `{ provider: 'hosted', placement: 'hosted-api', hostedProvider }`. */
export interface HostedExecutionRecord { provider: 'hosted'; placement: 'hosted-api'; hostedProvider: string; [key: string]: unknown }
export declare const ANSWER_PROVENANCE_SCHEMA: 'reploid.answer-provenance/v1';
export declare const SUPPLY_CLASSES: readonly SupplyClass[];
export declare const HOSTED_EXECUTION_REFUSED: string;
export declare const UNRECOGNIZED_EXECUTION_REFUSED: string;
export declare function supplyOf(classes: readonly SupplyClass[]): { supply: SupplyLabel; classes: SupplyClass[] };
export declare function classifyExecutionSupply(execution: unknown, options?: { localIds?: readonly string[] }): ExecutionSupply;
/** The refusal for hosted or unrecognized execution in a conversation, or null when the output may be accepted. */
export declare function executionRefusal(classified: ExecutionSupply): string | null;
export declare function retrievalSupply(attempt: { request?: { retrieval?: { route?: string } }; retrieval?: unknown;
  searchPermission?: { searchProvider?: string; searchServer?: string | null } }): RetrievalSupply;
export declare function attemptExecutionSupply(attempt: { execution?: unknown; status: string },
  options?: { localIds?: readonly string[]; produced?: boolean }): ExecutionSupply;
export declare function answerProvenance(thread: { attempts: readonly any[]; messages?: readonly { id: string; content: string }[] },
  attempt: { id: string; responseId?: string; retryOf?: string | null; status: string; execution?: unknown },
  options?: { localIds?: readonly string[] }): AnswerProvenance;
