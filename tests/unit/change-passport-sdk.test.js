import { describe, expect, it, vi } from 'vitest';

import {
  ChangePassportClient,
  ChangePassportHttpError
} from '../../sdk/change-passport/dist/index.js';

const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

describe('Change Passport TypeScript SDK runtime', () => {
  it('binds bearer identity, idempotency, and typed lifecycle methods to the API', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ projection: { passportId: 'passport:1' }, gate: { status: 'blocked' } }, 201))
      .mockResolvedValueOnce(response({ projection: { passportId: 'passport:1' }, gate: { status: 'blocked' } }, 201))
      .mockResolvedValueOnce(response({ projection: { passportId: 'passport:1', decision: { state: 'reopened' } }, gate: { status: 'blocked' } }, 201));
    const client = new ChangePassportClient({
      baseUrl: 'https://reploid.example/change-control/',
      accessToken: 'secret-token',
      clientId: 'test-sdk',
      fetchImpl
    });
    await client.createPassport({ passportId: 'passport:1' }, {
      role: 'proposer',
      idempotencyKey: 'create:1'
    });
    await client.submitEvidence('passport:1', { evidenceId: 'evidence:1' }, {
      role: 'evidence_producer',
      idempotencyKey: 'evidence:1'
    });
    await client.observeTrigger('passport:1', { ruleId: 'rule:1' }, {
      role: 'observer',
      idempotencyKey: 'trigger:1'
    });

    expect(fetchImpl.mock.calls[0][0]).toBe('https://reploid.example/change-control/passports');
    expect(fetchImpl.mock.calls[1][0]).toContain('/passports/passport%3A1/events');
    expect(fetchImpl.mock.calls[2][0]).toContain('/passports/passport%3A1/triggers');
    for (const call of fetchImpl.mock.calls) {
      const headers = call[1].headers;
      expect(headers.get('Authorization')).toBe('Bearer secret-token');
      expect(headers.get('X-Reploid-Client-Id')).toBe('test-sdk');
    }
    expect(fetchImpl.mock.calls[1][1].headers.get('Idempotency-Key')).toBe('evidence:1');
  });

  it('returns bounded HTTP errors without including the access token', async () => {
    const fetchImpl = vi.fn(async () => response({ error: 'role denied', code: 'ROLE_FORBIDDEN' }, 403));
    const client = new ChangePassportClient({
      baseUrl: 'https://reploid.example/change-control',
      accessToken: 'do-not-leak',
      fetchImpl
    });
    const error = await client.getPassport('passport:1').catch((caught) => caught);
    expect(error).toBeInstanceOf(ChangePassportHttpError);
    expect(error).toMatchObject({ status: 403, code: 'ROLE_FORBIDDEN', message: 'role denied' });
    expect(JSON.stringify(error)).not.toContain('do-not-leak');
  });
});
