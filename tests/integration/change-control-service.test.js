import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import express from 'express';
import nodeFetch from 'node-fetch';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createChangeControlAuthenticator } from '../../server/change-control/auth.js';
import { createFileChangeControlStore } from '../../server/change-control/file-store.js';
import { createChangeControlEffectRegistry } from '../../server/change-control/effects.js';
import { createChangeControlRouter } from '../../server/change-control/routes.js';
import { createChangeControlService } from '../../server/change-control/service.js';
import { createMemoryChangeControlStore } from '../../server/change-control/store.js';
import { hashChangePassportValue } from '../../self/shared/change-passport/contract.js';
import {
  advanceServiceToApproval,
  auth,
  createServiceFixturePolicy,
  createServiceStartPayload,
  digest,
  fixtureTimestamp
} from '../fixtures/change-passport/service-fixture.js';

const servers = [];
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const createClock = () => {
  let second = 20;
  return () => fixtureTimestamp(second++);
};

const createService = (store = createMemoryChangeControlStore(), options = {}) => createChangeControlService({
  store,
  now: createClock(),
  ...options
});

const createInitialPassport = async (service, options = {}) => {
  const policy = await createServiceFixturePolicy();
  const payload = createServiceStartPayload(policy, options);
  const proposer = auth(options.proposerAuthorityId || 'authority:proposer', ['proposer'], options.organizationId || 'org:test');
  const result = await service.createPassport({
    payload,
    role: 'proposer',
    idempotencyKey: options.idempotencyKey || 'create-passport'
  }, proposer);
  return { policy, payload, proposer, result };
};

describe('Change-control hosted service', () => {
  it('governs approval, activation, automatic reopening, and controlled rollback', async () => {
    const service = createService();
    await createInitialPassport(service);
    const approval = await advanceServiceToApproval(service);
    expect(approval.projection).toMatchObject({
      decision: { state: 'approved' },
      effect: { state: 'not_applied' }
    });

    const activator = auth('authority:activator', ['activator']);
    const decisionEventHash = approval.appendedEvents[0].eventHash;
    await service.appendEvent({
      passportId: 'passport:service:1',
      type: 'effect.requested',
      role: 'activator',
      idempotencyKey: 'effect-request',
      payload: {
        effectId: 'effect:service:1',
        kind: 'deployment',
        targetId: 'service:agent-runtime',
        candidateHash: digest('2'),
        decisionEventHash,
        idempotencyKey: 'deployment:service:1'
      }
    }, activator);
    await service.appendEvent({
      passportId: 'passport:service:1',
      type: 'effect.recorded',
      role: 'activator',
      idempotencyKey: 'effect-result',
      payload: {
        effectId: 'effect:service:1',
        status: 'applied',
        targetId: 'service:agent-runtime',
        candidateHash: digest('2'),
        externalReference: 'deployment:service:1',
        observedAt: fixtureTimestamp(30)
      }
    }, activator);

    const reopened = await service.observeTrigger({
      passportId: 'passport:service:1',
      role: 'observer',
      idempotencyKey: 'trigger-observation',
      payload: {
        ruleId: 'rule:metric-regression',
        condition: { regressed: true },
        observationHash: digest('9'),
        observedAt: fixtureTimestamp(31),
        deduplicationKey: 'metric-regression:1'
      }
    }, auth('authority:monitor', ['observer']));
    expect(reopened.triggerMatch).toMatchObject({ matched: true, requestedAction: 'rollback_request' });
    expect(reopened.appendedEvents.map((event) => event.type)).toEqual([
      'trigger.observed',
      'decision.reopened'
    ]);
    expect(reopened.projection.decision.state).toBe('reopened');
    expect(reopened.projection.effect.state).toBe('applied');

    const rollbackAuthority = auth('authority:rollback', ['rollback_authority']);
    const requested = await service.appendEvent({
      passportId: 'passport:service:1',
      type: 'rollback.requested',
      role: 'rollback_authority',
      idempotencyKey: 'rollback-request',
      payload: {
        rollbackId: 'rollback:service:1',
        effectId: 'effect:service:1',
        rollbackArtifactHash: digest('7'),
        targetId: 'service:agent-runtime',
        idempotencyKey: 'rollback:service:1',
        authorityId: 'authority:rollback',
        reason: 'The declared production metric regressed.'
      }
    }, rollbackAuthority);
    expect(requested.projection.effect.state).toBe('rollback_requested');
    const failed = await service.appendEvent({
      passportId: 'passport:service:1',
      type: 'rollback.recorded',
      role: 'rollback_authority',
      idempotencyKey: 'rollback-result-failed',
      payload: {
        rollbackId: 'rollback:service:1',
        status: 'failed',
        externalReference: 'deployment:rollback:1',
        observedAt: fixtureTimestamp(32),
        failureReason: 'Deployment provider rejected the rollback.'
      }
    }, rollbackAuthority);
    expect(failed.projection).toMatchObject({
      decision: { state: 'reopened' },
      effect: { state: 'rollback_failed' }
    });
    const retry = await service.appendEvent({
      passportId: 'passport:service:1',
      type: 'rollback.requested',
      role: 'rollback_authority',
      idempotencyKey: 'rollback-retry-request',
      payload: {
        rollbackId: 'rollback:service:2',
        effectId: 'effect:service:1',
        rollbackArtifactHash: digest('7'),
        targetId: 'service:agent-runtime',
        idempotencyKey: 'rollback:service:2',
        authorityId: 'authority:rollback',
        reason: 'Retry the explicitly failed controlled rollback.'
      }
    }, rollbackAuthority);
    expect(retry.projection.effect.state).toBe('rollback_requested');
  });

  it('enforces organization and role boundaries without revealing foreign passports', async () => {
    const service = createService();
    await createInitialPassport(service);
    await expect(service.getPassport(
      'passport:service:1',
      auth('authority:foreign', ['change_authority'], 'org:foreign')
    )).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.appendEvent({
      passportId: 'passport:service:1',
      type: 'evaluation.recorded',
      role: 'evaluator',
      idempotencyKey: 'forbidden-evaluation',
      payload: {}
    }, auth('authority:proposer', ['proposer']))).rejects.toMatchObject({
      statusCode: 403,
      code: 'ROLE_FORBIDDEN'
    });
  });

  it('returns idempotent retries and rejects concurrent stale appends', async () => {
    const service = createService();
    await createInitialPassport(service);
    const changeAuth = auth('authority:change', ['change_authority']);
    const triggerInput = {
      passportId: 'passport:service:1',
      type: 'trigger.declared',
      role: 'change_authority',
      idempotencyKey: 'same-trigger',
      payload: {
        ruleId: 'rule:metric-regression',
        sourceKind: 'production_monitor',
        observationKind: 'metric_threshold_crossed',
        targetId: 'service:agent-runtime',
        sensorAuthorityId: 'authority:monitor',
        freshnessMilliseconds: 60000,
        condition: {
          field: 'regressed',
          operator: 'equals',
          value: true
        },
        action: 'rollback_request'
      }
    };
    const first = await service.appendEvent(triggerInput, changeAuth);
    const retried = await service.appendEvent(triggerInput, changeAuth);
    expect(retried.projection.integrity.headHash).toBe(first.projection.integrity.headHash);
    expect(retried.projection.integrity.eventCount).toBe(2);

    const evidenceAuth = auth('authority:evidence', ['evidence_producer']);
    const evidence = (id, character) => ({
      passportId: 'passport:service:1',
      type: 'evidence.admitted',
      role: 'evidence_producer',
      idempotencyKey: `evidence-${id}`,
      payload: {
        evidenceId: `evidence:${id}`,
        kind: 'tests',
        digest: digest(character),
        source: `CI ${id}`,
        uri: null,
        summary: `Evidence ${id}`,
        observedAt: fixtureTimestamp(22),
        custody: { mode: 'reference_only', accessRequired: true, retention: 'source_owned' }
      }
    });
    const outcomes = await Promise.allSettled([
      service.appendEvent(evidence('a', 'a'), evidenceAuth),
      service.appendEvent(evidence('b', 'b'), evidenceAuth)
    ]);
    expect(outcomes.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((entry) => entry.status === 'rejected')[0].reason).toMatchObject({
      code: 'SEQUENCE_CONFLICT'
    });
  });

  it('reconstructs the same verified projection after a durable-store restart', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-change-control-'));
    temporaryDirectories.push(directory);
    const firstStore = createFileChangeControlStore({ rootDir: directory });
    const firstService = createService(firstStore);
    await createInitialPassport(firstService);
    const before = await firstService.getPassport('passport:service:1', auth('authority:proposer', ['proposer']));

    const secondStore = createFileChangeControlStore({ rootDir: directory });
    const secondService = createService(secondStore);
    const after = await secondService.getPassport('passport:service:1', auth('authority:reader', ['proposer']));
    expect(after.projection).toEqual(before.projection);
    expect(after.projection.integrity.valid).toBe(true);
  });

  it('exposes authenticated API routes and verifies durable GitHub webhook deliveries', async () => {
    const store = createMemoryChangeControlStore();
    const service = createService(store);
    const token = 'test-access-token';
    const webhookSecret = 'test-webhook-secret';
    const authenticate = createChangeControlAuthenticator({
      tokenEntries: [{
        token,
        principal: {
          subject: 'authority:proposer',
          authorityId: 'authority:proposer',
          organizationId: 'org:test',
          roles: ['proposer']
        }
      }]
    });
    const app = express();
    app.use(express.json({
      verify: (req, res, buffer) => {
        if (req.originalUrl.startsWith('/change-control/github/webhooks')) req.rawBody = Buffer.from(buffer);
      }
    }));
    app.use('/change-control', createChangeControlRouter({
      service,
      store,
      authenticate,
      githubWebhookSecret: webhookSecret
    }));
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    servers.push(server);
    const baseUrl = `http://127.0.0.1:${server.address().port}/change-control`;
    const status = await nodeFetch(`${baseUrl}/status`);
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      service: 'reploid-change-control',
      schema: 'change.passport/v1',
      persistence: 'memory',
      githubWebhookConfigured: true
    });
    expect((await nodeFetch(`${baseUrl}/passports`)).status).toBe(401);

    const policy = await createServiceFixturePolicy();
    const created = await nodeFetch(`${baseUrl}/passports`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'route-create'
      },
      body: JSON.stringify({ payload: createServiceStartPayload(policy) })
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      projection: { passportId: 'passport:service:1' }
    });

    const webhookBody = Buffer.from(JSON.stringify({ action: 'opened', pull_request: { number: 11 } }));
    const webhookSignature = `sha256=${crypto.createHmac('sha256', webhookSecret).update(webhookBody).digest('hex')}`;
    const sendWebhook = () => nodeFetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': webhookSignature,
        'X-GitHub-Delivery': 'delivery-1',
        'X-GitHub-Event': 'pull_request'
      },
      body: webhookBody
    });
    const webhook = await sendWebhook();
    expect(webhook.status).toBe(202);
    await expect(webhook.json()).resolves.toMatchObject({
      deliveryId: 'delivery-1',
      eventName: 'pull_request',
      accepted: true
    });
    const duplicate = await sendWebhook();
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ duplicate: true });

    const conflictingBody = Buffer.from(JSON.stringify({ action: 'closed', pull_request: { number: 11 } }));
    const conflictingSignature = `sha256=${crypto.createHmac('sha256', webhookSecret).update(conflictingBody).digest('hex')}`;
    const conflictingDelivery = await nodeFetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': conflictingSignature,
        'X-GitHub-Delivery': 'delivery-1',
        'X-GitHub-Event': 'pull_request'
      },
      body: conflictingBody
    });
    expect(conflictingDelivery.status).toBe(409);
    await expect(conflictingDelivery.json()).resolves.toMatchObject({
      code: 'GITHUB_DELIVERY_CONFLICT'
    });

    const invalidWebhook = await nodeFetch(`${baseUrl}/github/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': 'sha256=invalid',
        'X-GitHub-Delivery': 'delivery-2',
        'X-GitHub-Event': 'pull_request'
      },
      body: webhookBody
    });
    expect(invalidWebhook.status).toBe(401);
  });

  it('surfaces GitHub required-check failures without changing decision state', async () => {
    const githubClient = { upsertCheck: vi.fn(async () => { throw new Error('GitHub unavailable'); }) };
    const service = createService(createMemoryChangeControlStore(), {
      githubClient,
      detailsBaseUrl: 'https://replo.id'
    });
    const created = await createInitialPassport(service, { installationId: 99 });
    expect(created.result.githubCheck).toMatchObject({ attempted: true, ok: false, error: 'GitHub unavailable' });
    expect(created.result.projection.decision.state).toBe('proposed');
  });

  it('blocks force-pushed, forked, dismissed-review, and uninstalled GitHub authority changes', async () => {
    const githubClient = { upsertCheck: vi.fn(async (request) => ({ id: request.headSha })) };
    const service = createService(createMemoryChangeControlStore(), { githubClient });
    await createInitialPassport(service, { installationId: 99 });
    await advanceServiceToApproval(service);
    githubClient.upsertCheck.mockClear();

    const synchronized = await service.handleGitHubWebhook({
      eventName: 'pull_request',
      deliveryId: 'delivery-force-push',
      payload: {
        action: 'synchronize',
        repository: { full_name: 'clocksmith/agent-runtime' },
        pull_request: {
          number: 11,
          head: {
            sha: 'new-candidate-sha',
            repo: { full_name: 'clocksmith/agent-runtime' }
          }
        }
      }
    });
    expect(synchronized).toMatchObject({ action: 'pull_request_reconciled' });
    let current = await service.getPassport('passport:service:1', auth('authority:change', ['change_authority']));
    expect(current.gate.eligible).toBe(false);
    expect(current.projection.objections.at(-1).statement).toContain('frozen candidate is stale');
    expect(githubClient.upsertCheck).toHaveBeenCalledWith(expect.objectContaining({
      headSha: 'new-candidate-sha',
      conclusion: 'failure'
    }));

    const forked = await service.handleGitHubWebhook({
      eventName: 'pull_request',
      deliveryId: 'delivery-fork',
      payload: {
        action: 'reopened',
        repository: { full_name: 'clocksmith/agent-runtime' },
        pull_request: {
          number: 11,
          head: {
            sha: 'fork-candidate-sha',
            repo: { full_name: 'contributor/agent-runtime' }
          }
        }
      }
    });
    expect(forked.action).toBe('pull_request_reconciled');

    const dismissed = await service.handleGitHubWebhook({
      eventName: 'pull_request_review',
      deliveryId: 'delivery-review-dismissed',
      payload: {
        action: 'dismissed',
        repository: { full_name: 'clocksmith/agent-runtime' },
        pull_request: { number: 11 },
        review: { user: { login: 'authority:reviewer' } }
      }
    });
    expect(dismissed.action).toBe('dismissed_review_blocked');

    const uninstalled = await service.handleGitHubWebhook({
      eventName: 'installation',
      deliveryId: 'delivery-installation-deleted',
      payload: { action: 'deleted', installation: { id: 99 } }
    });
    expect(uninstalled.action).toBe('installation_authority_blocked');
    current = await service.getPassport('passport:service:1', auth('authority:change', ['change_authority']));
    expect(current.projection.objections.map((entry) => entry.statement).join('\n')).toContain('review authority authority:reviewer was dismissed');
    expect(current.projection.objections.map((entry) => entry.statement).join('\n')).toContain('installation 99 is deleted');
    expect(current.projection.decision.state).toBe('approved');
    expect(current.projection.effect.state).toBe('not_applied');
  });

  it('executes authorized effects and rollback adapters once across idempotent retries', async () => {
    const deployment = vi.fn(async () => ({ externalReference: 'provider:deployment:1' }));
    const rollback = vi.fn(async () => ({ externalReference: 'provider:rollback-pr:1' }));
    const effectRegistry = createChangeControlEffectRegistry({
      effects: { deployment },
      rollbacks: { github_revert: rollback }
    });
    const service = createService(createMemoryChangeControlStore(), { effectRegistry });
    await createInitialPassport(service);
    const approval = await advanceServiceToApproval(service);
    const effectInput = {
      passportId: 'passport:service:1',
      role: 'activator',
      idempotencyKey: 'execute-effect',
      payload: {
        effectId: 'effect:execute:1',
        kind: 'deployment',
        targetId: 'service:agent-runtime',
        candidateHash: digest('2'),
        decisionEventHash: approval.appendedEvents[0].eventHash,
        idempotencyKey: 'provider-deployment:1'
      }
    };
    const activator = auth('authority:activator', ['activator']);
    const applied = await service.executeEffect(effectInput, activator);
    expect(applied).toMatchObject({
      execution: { ok: true, externalReference: 'provider:deployment:1' },
      projection: { effect: { state: 'applied' } }
    });
    await service.executeEffect(effectInput, activator);
    expect(deployment).toHaveBeenCalledTimes(1);
    await expect(service.executeEffect(
      effectInput,
      auth('authority:proposer', ['proposer'])
    )).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN', statusCode: 403 });

    await service.observeTrigger({
      passportId: 'passport:service:1',
      role: 'observer',
      idempotencyKey: 'adapter-trigger',
      payload: {
        ruleId: 'rule:metric-regression',
        condition: { regressed: true },
        observationHash: digest('c'),
        observedAt: fixtureTimestamp(31),
        deduplicationKey: 'adapter-regression:1'
      }
    }, auth('authority:monitor', ['observer']));

    const rollbackInput = {
      passportId: 'passport:service:1',
      role: 'rollback_authority',
      idempotencyKey: 'execute-rollback',
      payload: {
        rollbackId: 'rollback:execute:1',
        effectId: 'effect:execute:1',
        rollbackArtifactHash: digest('7'),
        targetId: 'service:agent-runtime',
        idempotencyKey: 'provider-rollback:1',
        authorityId: 'authority:rollback',
        reason: 'The declared production trigger matched.'
      }
    };
    const rollbackAuth = auth('authority:rollback', ['rollback_authority']);
    const rolledBack = await service.executeRollback(rollbackInput, rollbackAuth);
    expect(rolledBack).toMatchObject({
      execution: { ok: true, externalReference: 'provider:rollback-pr:1' },
      projection: { decision: { state: 'reopened' }, effect: { state: 'rolled_back' } }
    });
    await service.executeRollback(rollbackInput, rollbackAuth);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('scopes caller-supplied effect identities to each passport', async () => {
    const deployment = vi.fn(async ({ projection }) => ({
      externalReference: `provider:${projection.passportId}`
    }));
    const effectRegistry = createChangeControlEffectRegistry({ effects: { deployment } });
    const service = createService(createMemoryChangeControlStore(), { effectRegistry });
    await createInitialPassport(service);
    const firstApproval = await advanceServiceToApproval(service);
    await createInitialPassport(service, {
      passportId: 'passport:service:2',
      proposalId: 'proposal:service:2',
      idempotencyKey: 'create-passport-2'
    });
    const secondApproval = await advanceServiceToApproval(service, 'passport:service:2');
    const activator = auth('authority:activator', ['activator']);
    const execute = (passportId, decisionEventHash, providerKey) => service.executeEffect({
      passportId,
      role: 'activator',
      idempotencyKey: `execute:${passportId}`,
      payload: {
        effectId: 'effect:shared-caller-id',
        kind: 'deployment',
        targetId: 'service:agent-runtime',
        candidateHash: digest('2'),
        decisionEventHash,
        idempotencyKey: providerKey
      }
    }, activator);

    const first = await execute(
      'passport:service:1',
      firstApproval.appendedEvents[0].eventHash,
      'provider:first'
    );
    const second = await execute(
      'passport:service:2',
      secondApproval.appendedEvents[0].eventHash,
      'provider:second'
    );
    expect(first.execution.externalReference).toBe('provider:passport:service:1');
    expect(second.execution.externalReference).toBe('provider:passport:service:2');
    expect(deployment).toHaveBeenCalledTimes(2);
  });

  it('repairs interrupted effect and rollback ledgers without repeating external actions', async () => {
    const deployment = vi.fn();
    const rollback = vi.fn();
    const store = createMemoryChangeControlStore();
    const effectRegistry = createChangeControlEffectRegistry({
      effects: { deployment },
      rollbacks: { github_revert: rollback }
    });
    const service = createService(store, { effectRegistry });
    await createInitialPassport(service);
    const approval = await advanceServiceToApproval(service);
    const activator = auth('authority:activator', ['activator']);
    const effectPayload = {
      effectId: 'effect:interrupted:1',
      kind: 'deployment',
      targetId: 'service:agent-runtime',
      candidateHash: digest('2'),
      decisionEventHash: approval.appendedEvents[0].eventHash,
      idempotencyKey: 'provider:interrupted:effect'
    };
    const requestedEffect = await service.appendEvent({
      passportId: 'passport:service:1',
      type: 'effect.requested',
      payload: effectPayload,
      role: 'activator',
      idempotencyKey: 'interrupted-effect-request'
    }, activator);
    const normalizedEffect = requestedEffect.appendedEvents[0].payload;
    const effectDeliveryId = await hashChangePassportValue({
      source: 'effect_execution',
      passportId: 'passport:service:1',
      requestId: effectPayload.effectId
    });
    const effectRequestHash = await hashChangePassportValue({
      passportId: 'passport:service:1',
      request: normalizedEffect
    });
    await store.saveDelivery({
      source: 'effect_execution',
      deliveryId: effectDeliveryId,
      requestHash: effectRequestHash,
      result: { ok: true, externalReference: 'provider:effect:already-applied' }
    });

    const repairedEffect = await service.executeEffect({
      passportId: 'passport:service:1',
      payload: effectPayload,
      role: 'activator',
      idempotencyKey: 'interrupted-effect-retry'
    }, activator);
    expect(repairedEffect.projection.effect.state).toBe('applied');
    expect(repairedEffect.execution.externalReference).toBe('provider:effect:already-applied');
    expect(deployment).not.toHaveBeenCalled();

    await service.observeTrigger({
      passportId: 'passport:service:1',
      role: 'observer',
      idempotencyKey: 'interrupted-trigger',
      payload: {
        ruleId: 'rule:metric-regression',
        condition: { regressed: true },
        observationHash: digest('d'),
        observedAt: fixtureTimestamp(31),
        deduplicationKey: 'interrupted-regression:1'
      }
    }, auth('authority:monitor', ['observer']));
    const rollbackAuth = auth('authority:rollback', ['rollback_authority']);
    const rollbackPayload = {
      rollbackId: 'rollback:interrupted:1',
      effectId: effectPayload.effectId,
      rollbackArtifactHash: digest('7'),
      targetId: 'service:agent-runtime',
      idempotencyKey: 'provider:interrupted:rollback',
      authorityId: 'authority:rollback',
      reason: 'Resume the controlled rollback after interruption.'
    };
    const requestedRollback = await service.appendEvent({
      passportId: 'passport:service:1',
      type: 'rollback.requested',
      payload: rollbackPayload,
      role: 'rollback_authority',
      idempotencyKey: 'interrupted-rollback-request'
    }, rollbackAuth);
    const normalizedRollback = requestedRollback.appendedEvents[0].payload;
    await service.appendEvent({
      passportId: 'passport:service:1',
      type: 'rollback.recorded',
      payload: {
        rollbackId: rollbackPayload.rollbackId,
        status: 'started',
        externalReference: 'provider:rollback:started',
        observedAt: fixtureTimestamp(32)
      },
      role: 'rollback_authority',
      idempotencyKey: 'interrupted-rollback-started'
    }, rollbackAuth);
    const rollbackDeliveryId = await hashChangePassportValue({
      source: 'rollback_execution',
      passportId: 'passport:service:1',
      requestId: rollbackPayload.rollbackId
    });
    const rollbackRequestHash = await hashChangePassportValue({
      passportId: 'passport:service:1',
      request: normalizedRollback
    });
    await store.saveDelivery({
      source: 'rollback_execution',
      deliveryId: rollbackDeliveryId,
      requestHash: rollbackRequestHash,
      result: { ok: true, externalReference: 'provider:rollback:already-applied' }
    });

    const repairedRollback = await service.executeRollback({
      passportId: 'passport:service:1',
      payload: rollbackPayload,
      role: 'rollback_authority',
      idempotencyKey: 'interrupted-rollback-retry'
    }, rollbackAuth);
    expect(repairedRollback.projection.effect.state).toBe('rolled_back');
    expect(repairedRollback.execution.externalReference).toBe('provider:rollback:already-applied');
    expect(rollback).not.toHaveBeenCalled();
  });
});
