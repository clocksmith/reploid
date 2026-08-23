/**
 * @fileoverview HTTP routes for Change Passport lifecycle and GitHub webhooks.
 */

import express from 'express';

import { hashChangePassportValue } from '../../self/shared/change-passport/contract.js';
import { verifyGitHubWebhookSignature } from './github.js';

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const idempotencyKey = (req) => String(req.headers['idempotency-key'] || req.body?.idempotencyKey || '').trim();

export function createChangeControlRouter({
  service,
  store,
  authenticate,
  githubWebhookSecret = null,
  githubWebhookHandler = null
} = {}) {
  if (!service) throw new Error('Change-control service is required');
  if (!store) throw new Error('Change-control store is required');
  if (typeof authenticate !== 'function') throw new Error('Change-control authenticator is required');
  const router = express.Router();

  router.get('/status', (req, res) => {
    res.json({
      service: 'reploid-change-control',
      schema: 'change.passport/v1',
      githubWebhookConfigured: !!githubWebhookSecret,
      persistence: store.kind || store.constructor?.name || 'change-control-store'
    });
  });

  router.post('/github/webhooks', asyncRoute(async (req, res) => {
    if (!githubWebhookSecret) return res.status(503).json({ error: 'GitHub webhook is not configured' });
    if (!Buffer.isBuffer(req.rawBody)) {
      return res.status(400).json({ error: 'GitHub webhook raw body is unavailable' });
    }
    const signature = req.headers['x-hub-signature-256'];
    if (!verifyGitHubWebhookSignature({ secret: githubWebhookSecret, rawBody: req.rawBody, signature })) {
      return res.status(401).json({ error: 'GitHub webhook signature is invalid' });
    }
    const deliveryId = String(req.headers['x-github-delivery'] || '').trim();
    const eventName = String(req.headers['x-github-event'] || '').trim();
    if (!deliveryId || !eventName) return res.status(400).json({ error: 'GitHub delivery identity is required' });
    const requestHash = await hashChangePassportValue({ eventName, body: req.body });
    const prior = await store.getDeliveryRecord('github_webhook', deliveryId);
    if (prior) {
      if (prior.requestHash !== requestHash) {
        return res.status(409).json({
          error: 'GitHub delivery identity was reused with different signed content',
          code: 'GITHUB_DELIVERY_CONFLICT'
        });
      }
      return res.json({ ...prior.result, duplicate: true });
    }
    const handled = githubWebhookHandler
      ? await githubWebhookHandler({ eventName, deliveryId, payload: req.body })
      : { accepted: true, action: 'recorded_only' };
    const result = {
      deliveryId,
      eventName,
      accepted: handled?.accepted !== false,
      action: handled?.action || 'recorded_only'
    };
    await store.saveDelivery({ source: 'github_webhook', deliveryId, requestHash, result });
    return res.status(202).json(result);
  }));

  router.use(authenticate);

  router.get('/principal', (req, res) => {
    const auth = req.changeControlAuth;
    res.json({
      authorityId: auth.authorityId,
      organizationId: auth.organizationId,
      roles: [...auth.roles],
      authenticationKind: auth.authenticationKind
    });
  });

  router.get('/passports', asyncRoute(async (req, res) => {
    res.json({ passports: await service.listPassports(req.changeControlAuth) });
  }));

  router.post('/passports', asyncRoute(async (req, res) => {
    const result = await service.createPassport({
      payload: req.body?.payload || req.body,
      role: req.body?.role || 'proposer',
      idempotencyKey: idempotencyKey(req)
    }, req.changeControlAuth);
    res.status(201).json(result);
  }));

  router.get('/passports/:passportId', asyncRoute(async (req, res) => {
    res.json(await service.getPassport(req.params.passportId, req.changeControlAuth));
  }));

  router.get('/passports/:passportId/events', asyncRoute(async (req, res) => {
    res.json({ events: await service.getEvents(req.params.passportId, req.changeControlAuth) });
  }));

  router.get('/passports/:passportId/export', asyncRoute(async (req, res) => {
    const exported = await service.exportPassport(req.params.passportId, req.changeControlAuth);
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.passportId}.change-passport.json"`);
    res.json(exported);
  }));

  router.post('/passports/:passportId/events', asyncRoute(async (req, res) => {
    const result = await service.appendEvent({
      passportId: req.params.passportId,
      type: req.body?.type,
      payload: req.body?.payload,
      role: req.body?.role,
      idempotencyKey: idempotencyKey(req)
    }, req.changeControlAuth);
    res.status(201).json(result);
  }));

  router.post('/passports/:passportId/triggers', asyncRoute(async (req, res) => {
    const result = await service.observeTrigger({
      passportId: req.params.passportId,
      payload: req.body?.payload || req.body,
      role: req.body?.role || 'observer',
      idempotencyKey: idempotencyKey(req)
    }, req.changeControlAuth);
    res.status(201).json(result);
  }));

  router.post('/passports/:passportId/triggers/standard', asyncRoute(async (req, res) => {
    const result = await service.observeStandardTrigger({
      passportId: req.params.passportId,
      kind: req.body?.kind,
      ruleId: req.body?.ruleId,
      data: req.body?.data,
      observedAt: req.body?.observedAt,
      deduplicationKey: req.body?.deduplicationKey,
      role: req.body?.role || 'observer',
      idempotencyKey: idempotencyKey(req)
    }, req.changeControlAuth);
    res.status(201).json(result);
  }));

  router.post('/passports/:passportId/effects/execute', asyncRoute(async (req, res) => {
    const result = await service.executeEffect({
      passportId: req.params.passportId,
      payload: req.body?.payload || req.body,
      role: req.body?.role || 'activator',
      idempotencyKey: idempotencyKey(req)
    }, req.changeControlAuth);
    res.status(201).json(result);
  }));

  router.post('/passports/:passportId/rollbacks/execute', asyncRoute(async (req, res) => {
    const result = await service.executeRollback({
      passportId: req.params.passportId,
      payload: req.body?.payload || req.body,
      role: req.body?.role || 'rollback_authority',
      idempotencyKey: idempotencyKey(req)
    }, req.changeControlAuth);
    res.status(201).json(result);
  }));

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number(error.statusCode || (error.code === 'SEQUENCE_CONFLICT' ? 409 : 400));
    return res.status(status).json({
      error: error.message,
      code: error.code || 'CHANGE_CONTROL_ERROR',
      ...(error.actualSequence !== undefined ? { actualSequence: error.actualSequence } : {})
    });
  });

  return router;
}

export default createChangeControlRouter;
