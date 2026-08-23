/**
 * @fileoverview Browser client for the hosted Change Passport API.
 */

export class ChangePassportBrowserClient {
  constructor({ baseUrl, accessToken, fetchImpl = globalThis.fetch } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.accessToken = String(accessToken || '');
    this.fetchImpl = typeof fetchImpl?.bind === 'function' ? fetchImpl.bind(globalThis) : fetchImpl;
    if (!this.baseUrl) throw new Error('Change Passport service URL is required');
    if (!this.accessToken) throw new Error('Change Passport access token is required');
  }

  async request(path, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set('Accept', 'application/json');
    headers.set('Authorization', `Bearer ${this.accessToken}`);
    headers.set('X-Reploid-Client-Id', 'change-passport-browser');
    if (init.body) headers.set('Content-Type', 'application/json');
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    const raw = await response.text();
    let body;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = { raw }; }
    if (!response.ok) {
      const error = new Error(body?.error || `Change Passport request failed with ${response.status}`);
      error.status = response.status;
      error.code = body?.code || null;
      throw error;
    }
    return body;
  }

  write(path, body, idempotencyKey) {
    return this.request(path, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body)
    });
  }

  async list() { return (await this.request('/passports')).passports; }
  principal() { return this.request('/principal'); }
  get(passportId) { return this.request(`/passports/${encodeURIComponent(passportId)}`); }
  async events(passportId) { return (await this.request(`/passports/${encodeURIComponent(passportId)}/events`)).events; }
  create(payload, role, idempotencyKey) { return this.write('/passports', { payload, role }, idempotencyKey); }
  append(passportId, type, payload, role, idempotencyKey) {
    return this.write(`/passports/${encodeURIComponent(passportId)}/events`, { type, payload, role }, idempotencyKey);
  }
  observeTrigger(passportId, payload, role, idempotencyKey) {
    return this.write(`/passports/${encodeURIComponent(passportId)}/triggers`, { payload, role }, idempotencyKey);
  }
  executeEffect(passportId, payload, role, idempotencyKey) {
    return this.write(`/passports/${encodeURIComponent(passportId)}/effects/execute`, { payload, role }, idempotencyKey);
  }
  executeRollback(passportId, payload, role, idempotencyKey) {
    return this.write(`/passports/${encodeURIComponent(passportId)}/rollbacks/execute`, { payload, role }, idempotencyKey);
  }
  export(passportId) { return this.request(`/passports/${encodeURIComponent(passportId)}/export`); }
}

export default ChangePassportBrowserClient;
