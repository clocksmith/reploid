export declare function compactAgreementForAcceptance(
  agreement?: Record<string, unknown> | null
): Record<string, unknown> | null;

export declare const ACCEPTANCE_V2: 'poolday.requester_acceptance/v2';
export declare const ACCEPTANCE_V2_DOMAIN: 'poolday.requester_acceptance.v2';
export declare function canonicalAcceptanceAgreement(input?: Record<string, unknown>): Record<string, unknown>;
export declare function canonicalAcceptanceTerms(input?: Record<string, unknown>): Record<string, unknown>;
export declare function acceptanceV2SigningPayload(input?: Record<string, unknown>): Record<string, unknown>;
