import type { ExecutionPolicy, PrivacyRequest } from './execution-policy.js';
export interface ExecutionOffer {
  schema: 'reploid.execution-offer/v1'; id: string; backend: string; kind: 'plaintext' | 'attested' | 'cryptographic';
  modelIdentities: string[]; operation: 'generate' | 'embed' | 'rerank' | 'encodeSequence' | 'scoreChoices'; protocol: string | null; evidence: string | null;
}
export declare function validateExecutionOffers(input: unknown): ExecutionOffer[];
export declare function eligibleExecutionOffers(request: PrivacyRequest & {privacy: ExecutionPolicy; operation?: ExecutionOffer['operation']}, offers: unknown, recipients: string[]): ExecutionOffer[];
