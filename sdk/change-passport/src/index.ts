import { verifyChangePassportExport } from '../../../self/core/change-passport.js';

export type ChangeClass =
  | 'model'
  | 'prompt'
  | 'agent_tool'
  | 'agent_policy'
  | 'agent_configuration';

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
  evidence: { state: EvidenceState; admitted: Array<Record<string, unknown>>; excluded: Array<Record<string, unknown>> };
  decision: { state: DecisionState; current: Record<string, unknown> | null };
  effect: { state: EffectState; current: Record<string, unknown> | null };
  integrity: { valid: boolean; eventCount: number; headHash: string | null; reasons: string[] };
  [key: string]: unknown;
}

export interface ChangePassportResult {
  projection: ChangePassportProjection;
  gate: { eligible: boolean; status: 'eligible' | 'blocked'; reasons: string[] };
  appendedEvents?: Array<Record<string, unknown>>;
  githubCheck?: Record<string, unknown>;
  triggerMatch?: Record<string, unknown>;
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

export class ChangePassportHttpError extends Error {
  status: number;
  code: string | null;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ChangePassportHttpError';
    this.status = status;
    this.code = typeof body === 'object' && body && 'code' in body ? String((body as { code?: unknown }).code || '') : null;
    this.body = body;
  }
}

export class ChangePassportClient {
  private baseUrl: string;
  private accessToken: string | null;
  private clientId: string;
  private fetchImpl: typeof fetch;

  constructor(options: ChangePassportClientOptions) {
    this.baseUrl = String(options.baseUrl || '').replace(/\/+$/, '');
    if (!this.baseUrl) throw new Error('Change Passport baseUrl is required');
    this.accessToken = options.accessToken ? String(options.accessToken) : null;
    this.clientId = String(options.clientId || 'reploid-change-passport-sdk');
    const selectedFetch = options.fetchImpl || globalThis.fetch;
    if (typeof selectedFetch !== 'function') throw new Error('fetch is unavailable');
    this.fetchImpl = selectedFetch.bind(globalThis);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers || {});
    headers.set('Accept', 'application/json');
    headers.set('X-Reploid-Client-Id', this.clientId);
    if (this.accessToken) headers.set('Authorization', `Bearer ${this.accessToken}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    const raw = await response.text();
    let body: unknown = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = { raw }; }
    if (!response.ok) {
      const message = typeof body === 'object' && body && 'error' in body
        ? String((body as { error?: unknown }).error)
        : `Change Passport request failed with ${response.status}`;
      throw new ChangePassportHttpError(message, response.status, body);
    }
    return body as T;
  }

  private writeHeaders(idempotencyKey: string): HeadersInit {
    if (!idempotencyKey) throw new Error('idempotencyKey is required');
    return { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey };
  }

  async createPassport(payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult> {
    return this.request('/passports', {
      method: 'POST',
      headers: this.writeHeaders(options.idempotencyKey),
      body: JSON.stringify({ payload, role: options.role })
    });
  }

  async listPassports(): Promise<Array<Record<string, unknown>>> {
    const result = await this.request<{ passports: Array<Record<string, unknown>> }>('/passports');
    return result.passports;
  }

  async getPrincipal(): Promise<{ authorityId: string; organizationId: string; roles: string[]; authenticationKind: string }> {
    return this.request('/principal');
  }

  async getPassport(passportId: string): Promise<ChangePassportResult> {
    return this.request(`/passports/${encodeURIComponent(passportId)}`);
  }

  async getEvents(passportId: string): Promise<Array<Record<string, unknown>>> {
    const result = await this.request<{ events: Array<Record<string, unknown>> }>(
      `/passports/${encodeURIComponent(passportId)}/events`
    );
    return result.events;
  }

  async appendEvent(
    passportId: string,
    type: string,
    payload: Record<string, unknown>,
    options: AppendOptions
  ): Promise<ChangePassportResult> {
    return this.request(`/passports/${encodeURIComponent(passportId)}/events`, {
      method: 'POST',
      headers: this.writeHeaders(options.idempotencyKey),
      body: JSON.stringify({ type, payload, role: options.role })
    });
  }

  async submitEvidence(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult> {
    return this.appendEvent(passportId, 'evidence.admitted', payload, options);
  }

  async excludeEvidence(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult> {
    return this.appendEvent(passportId, 'evidence.excluded', payload, options);
  }

  async recordObjection(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult> {
    return this.appendEvent(passportId, 'objection.recorded', payload, options);
  }

  async submitEvaluation(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult> {
    return this.appendEvent(passportId, 'evaluation.recorded', payload, options);
  }

  async recordReview(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult> {
    return this.appendEvent(passportId, 'review.recorded', payload, options);
  }

  async requestDecision(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult> {
    return this.appendEvent(passportId, 'decision.recorded', payload, options);
  }

  async recordEffect(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult> {
    return this.appendEvent(passportId, 'effect.recorded', payload, options);
  }

  async recordOutcome(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult> {
    return this.appendEvent(passportId, 'outcome.recorded', payload, options);
  }

  async observeTrigger(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult> {
    return this.request(`/passports/${encodeURIComponent(passportId)}/triggers`, {
      method: 'POST',
      headers: this.writeHeaders(options.idempotencyKey),
      body: JSON.stringify({ payload, role: options.role })
    });
  }

  async observeStandardTrigger(passportId: string, input: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult> {
    return this.request(`/passports/${encodeURIComponent(passportId)}/triggers/standard`, {
      method: 'POST',
      headers: this.writeHeaders(options.idempotencyKey),
      body: JSON.stringify({ ...input, role: options.role })
    });
  }

  async requestRollback(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult> {
    return this.appendEvent(passportId, 'rollback.requested', payload, options);
  }

  async executeEffect(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult> {
    return this.request(`/passports/${encodeURIComponent(passportId)}/effects/execute`, {
      method: 'POST',
      headers: this.writeHeaders(options.idempotencyKey),
      body: JSON.stringify({ payload, role: options.role })
    });
  }

  async executeRollback(passportId: string, payload: Record<string, unknown>, options: AppendOptions): Promise<ChangePassportResult> {
    return this.request(`/passports/${encodeURIComponent(passportId)}/rollbacks/execute`, {
      method: 'POST',
      headers: this.writeHeaders(options.idempotencyKey),
      body: JSON.stringify({ payload, role: options.role })
    });
  }

  async exportPassport(passportId: string): Promise<Record<string, unknown>> {
    return this.request(`/passports/${encodeURIComponent(passportId)}/export`);
  }

  async verifyPassport(exported: Record<string, unknown>): Promise<Awaited<ReturnType<typeof verifyChangePassportExport>>> {
    return verifyChangePassportExport(exported);
  }
}

export default ChangePassportClient;
