import type { ExecutionBinding } from '../../chat/execution-policy.js';
import type { PackPeerConsent } from '../../contracts/pool/peer-pack-job.js';
export declare const OPERATION_CONSENT_SCHEMA: 'reploid.peer.execution_consent/v2';
export declare function operationConsentRequirements(consent: PackPeerConsent): {modelId?: string; offerId?: string; privacy?: ExecutionBinding['policy']};
export declare function verifyOperationConsent(consent: PackPeerConsent, detail: {modelId: string; modelIdentity: string; adapterIdentities: string[]; operation: {name: string; version: number}; providerId: string}): Promise<ExecutionBinding | null>;
export declare function operationObserverEvidence(detail: {stage: string; operation: string; modelId: string; providerId: string; offerId: string; binding: ExecutionBinding; attemptId: string}): Record<string, unknown>;
