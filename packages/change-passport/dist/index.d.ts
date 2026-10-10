export type ChangeClass = 'model' | 'prompt' | 'agent_tool' | 'agent_policy' | 'agent_configuration' | 'source_patch';
export type EvidenceState = 'collecting' | 'frozen' | 'invalidated' | 'superseded';
export type DecisionState = 'proposed' | 'contested' | 'approved' | 'rejected' | 'unresolved' | 'reopened' | 'revoked';
export type EffectState = 'not_applied' | 'applied' | 'degraded' | 'rollback_requested' | 'rolled_back' | 'rollback_failed';
export interface ChangePassportProjection {
    schema: 'change.passport/v1';
    passportId: string;
    organizationId: string;
    changeClass: ChangeClass;
    proposal: Record<string, unknown>;
    policy: Record<string, unknown>;
    evidence: {
        state: EvidenceState;
        admitted: Array<Record<string, unknown>>;
        excluded: Array<Record<string, unknown>>;
    };
    decision: {
        state: DecisionState;
        current: Record<string, unknown> | null;
    };
    effect: {
        state: EffectState;
        current: Record<string, unknown> | null;
    };
    integrity: {
        valid: boolean;
        eventCount: number;
        headHash: string | null;
        reasons: string[];
    };
    [key: string]: unknown;
}
export interface ChangePassportResult {
    projection: ChangePassportProjection;
    gate: {
        eligible: boolean;
        status: 'eligible' | 'blocked';
        reasons: string[];
    };
    appendedEvents?: Array<Record<string, unknown>>;
    githubCheck?: Record<string, unknown>;
    triggerMatch?: Record<string, unknown>;
}
export interface ChangePassportVerificationResult {
    valid: boolean;
    projection: ChangePassportProjection;
    integrity: {
        valid: boolean;
        eventCount: number;
        headHash: string | null;
        reasons: string[];
    };
    exportHash: string | null;
    reasons: string[];
}
export interface ChangePassportClientOptions {
    baseUrl: string;
    accessToken?: string;
    clientId?: string;
    fetchImpl?: typeof fetch;
}
export interface AppendOptions {
    role: string;
    idempotencyKey: string;
}
export declare class ChangePassportHttpError extends Error {
    status: number;
    code: string | null;
    body: unknown;
    constructor(message: string, status: number, body: unknown);
}
export declare class ChangePassportClient {
    private baseUrl;
    private accessToken;
    private clientId;
    private fetchImpl;
    constructor(options: ChangePassportClientOptions);
    private request;
    private writeHeaders;
    createPassport(payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult>;
    listPassports(): Promise<Array<Record<string, unknown>>>;
    getPrincipal(): Promise<{
        authorityId: string;
        organizationId: string;
        roles: string[];
        authenticationKind: string;
    }>;
    getPassport(passportId: string): Promise<ChangePassportResult>;
    getEvents(passportId: string): Promise<Array<Record<string, unknown>>>;
    appendEvent(passportId: string, type: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult>;
    submitEvidence(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult>;
    excludeEvidence(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult>;
    recordObjection(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult>;
    submitEvaluation(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult>;
    recordReview(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult>;
    requestDecision(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult>;
    recordEffect(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult>;
    recordOutcome(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult>;
    observeTrigger(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult>;
    observeStandardTrigger(passportId: string, input: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult>;
    requestRollback(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult>;
    executeEffect(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult>;
    executeRollback(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult>;
    exportPassport(passportId: string): Promise<Record<string, unknown>>;
    verifyPassport(exported: Record<string, unknown>): Promise<ChangePassportVerificationResult>;
}
export default ChangePassportClient;
