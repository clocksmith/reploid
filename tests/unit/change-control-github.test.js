import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  buildGitHubAppJwt,
  createGitHubAppClient,
  toGitHubCheckProjection,
  verifyGitHubWebhookSignature
} from '../../server/change-control/github.js';

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : 'Error',
  text: async () => JSON.stringify(body)
});

describe('Change Passport GitHub integration', () => {
  it('builds a bounded GitHub App JWT', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const now = Date.parse('2026-08-22T20:00:00.000Z');
    const jwt = buildGitHubAppJwt({ appId: '1234', privateKey, now });
    const [header, payload, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toMatchObject({ iss: '1234' });
    expect(crypto.verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('verifies webhook HMAC without accepting modified bytes', () => {
    const secret = 'test-webhook-secret';
    const rawBody = Buffer.from('{"action":"opened"}');
    const signature = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    expect(verifyGitHubWebhookSignature({ secret, rawBody, signature })).toBe(true);
    expect(verifyGitHubWebhookSignature({
      secret,
      rawBody: Buffer.from('{"action":"closed"}'),
      signature
    })).toBe(false);
  });

  it('creates then updates one required check by external passport identity', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ token: 'installation-token', expiresAt: '2026-08-22T22:00:00.000Z', expires_at: '2026-08-22T22:00:00.000Z' }))
      .mockResolvedValueOnce(jsonResponse({ check_runs: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 91, external_id: 'passport:1' }))
      .mockResolvedValueOnce(jsonResponse({ check_runs: [{ id: 91, external_id: 'passport:1' }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 91, conclusion: 'success' }));
    const client = createGitHubAppClient({
      appId: '1234',
      privateKey,
      apiBase: 'https://github.example/api/v3',
      fetchImpl,
      now: () => Date.parse('2026-08-22T20:00:00.000Z')
    });
    const request = {
      installationId: 99,
      owner: 'clocksmith',
      repo: 'agent',
      headSha: 'abc123',
      passportId: 'passport:1',
      status: 'in_progress',
      title: 'Change blocked',
      summary: 'Evidence is incomplete.'
    };
    await expect(client.upsertCheck(request)).resolves.toMatchObject({ id: 91 });
    await expect(client.upsertCheck({
      ...request,
      status: 'completed',
      conclusion: 'success',
      title: 'Change eligible',
      summary: 'Policy passed.'
    })).resolves.toMatchObject({ id: 91, conclusion: 'success' });
    expect(fetchImpl.mock.calls[2][1].method).toBe('POST');
    expect(fetchImpl.mock.calls[4][1].method).toBe('PATCH');
    expect(fetchImpl.mock.calls[4][0]).toContain('/check-runs/91');
  });

  it('reuses a matching GitHub deployment instead of creating a duplicate', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const existingDeployment = {
      id: 44,
      url: 'https://github.example/deployments/44',
      payload: {
        schema: 'change.passport-github-deployment/v1',
        passportId: 'passport:1',
        idempotencyKey: 'deploy:1'
      }
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ token: 'installation-token', expiresAt: '2026-08-22T22:00:00.000Z' }))
      .mockResolvedValueOnce(jsonResponse([existingDeployment]));
    const client = createGitHubAppClient({
      appId: '1234',
      privateKey,
      apiBase: 'https://github.example/api/v3',
      fetchImpl,
      now: () => Date.parse('2026-08-22T20:00:00.000Z')
    });

    await expect(client.createDeployment({
      installationId: 99,
      owner: 'clocksmith',
      repo: 'agent',
      ref: 'candidate-sha',
      environment: 'production',
      passportId: 'passport:1',
      description: 'Governed deployment',
      idempotencyKey: 'deploy:1'
    })).resolves.toEqual(existingDeployment);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toContain('/deployments?ref=candidate-sha');
  });

  it('builds rollback as a restore-tree commit on the current base before opening a PR', async () => {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ token: 'installation-token', expiresAt: '2026-08-22T22:00:00.000Z' }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ object: { sha: 'current-base-sha' } }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'prior-sha', tree: { sha: 'prior-tree-sha' } }))
      .mockResolvedValueOnce(jsonResponse({ sha: 'restore-commit-sha' }, 201))
      .mockResolvedValueOnce(jsonResponse({ ref: 'refs/heads/reploid/rollback-passport-1-rollback-1' }, 201))
      .mockResolvedValueOnce(jsonResponse({ number: 19, html_url: 'https://github.example/pull/19' }, 201));
    const client = createGitHubAppClient({
      appId: '1234',
      privateKey,
      apiBase: 'https://github.example/api/v3',
      fetchImpl,
      now: () => Date.parse('2026-08-22T20:00:00.000Z')
    });

    await expect(client.createRollbackPullRequest({
      installationId: 99,
      owner: 'clocksmith',
      repo: 'agent',
      baseBranch: 'main',
      rollbackRevision: 'prior-sha',
      passportId: 'passport:1',
      rollbackId: 'rollback:1',
      reason: 'Declared regression matched.'
    })).resolves.toMatchObject({ number: 19 });

    const commitRequest = JSON.parse(fetchImpl.mock.calls[5][1].body);
    expect(commitRequest).toMatchObject({
      tree: 'prior-tree-sha',
      parents: ['current-base-sha']
    });
    const refRequest = JSON.parse(fetchImpl.mock.calls[6][1].body);
    expect(refRequest.sha).toBe('restore-commit-sha');
  });

  it('maps decision state to fail-closed required checks', () => {
    expect(toGitHubCheckProjection({ decision: { state: 'approved' } }, { eligible: true }))
      .toMatchObject({ status: 'completed', conclusion: 'success' });
    expect(toGitHubCheckProjection({ decision: { state: 'reopened' } }, { eligible: false }))
      .toMatchObject({ status: 'completed', conclusion: 'failure' });
    expect(toGitHubCheckProjection({ decision: { state: 'proposed' } }, { eligible: false, reasons: ['missing evidence'] }))
      .toMatchObject({ status: 'in_progress', conclusion: null, summary: 'missing evidence' });
  });
});
