/**
 * @fileoverview Pool coordinator routes for fastest-receipt launch slice.
 */

import express from 'express';
import poolStore from './store.js';
import { validateJobRequest } from './policy-router.js';
import { assignJob } from './scheduler.js';
import { verifyReceipt, verifyRequesterAcceptance } from './verifier.js';
import { awardAcceptedReceipt } from './points.js';
import { recordAcceptedReceipt, recordRejectedReceipt } from './reputation.js';

export function createPoolRouter({ store = poolStore } = {}) {
  const router = express.Router();

  router.post('/providers/register', (req, res) => {
    const body = req.body || {};
    if (!Array.isArray(body.models) || body.models.length === 0) {
      return res.status(400).json({ error: 'models are required' });
    }
    const invalidModel = body.models.find((model) => (
      !model.modelId || !model.modelHash || !model.manifestHash || model.runtime !== 'doppler' || model.backend !== 'browser-webgpu'
    ));
    if (invalidModel) {
      return res.status(400).json({
        error: 'each model must include modelId, modelHash, manifestHash, runtime=doppler, backend=browser-webgpu'
      });
    }
    if (!body.publicKey) {
      return res.status(400).json({ error: 'publicKey is required' });
    }
    const provider = store.registerProvider(body);
    res.json(provider);
  });

  router.post('/providers/heartbeat', (req, res) => {
    const heartbeat = store.heartbeat(req.body || {});
    if (!heartbeat) return res.status(404).json({ error: 'provider session not found' });
    res.json(heartbeat);
  });

  router.get('/providers/assignments/next', (req, res) => {
    store.expireStaleAssignments();
    const providerId = String(req.query.providerId || '').trim();
    if (!providerId) return res.status(400).json({ error: 'providerId is required' });
    res.json({ assignment: store.nextAssignmentForProvider(providerId) });
  });

  router.post('/jobs', async (req, res) => {
    store.expireStaleAssignments();
    const validation = validateJobRequest(req.body || {});
    if (!validation.ok) {
      return res.status(400).json({ error: 'invalid job request', reasons: validation.reasons });
    }
    const job = store.createJob({
      requesterId: req.body.requesterId,
      prompt: req.body.prompt,
      policyId: validation.policyId,
      requesterPublicKey: req.body.requesterPublicKey,
      modelRequirements: req.body.modelRequirements || {},
      generationConfig: req.body.generationConfig || {},
      verificationLevel: req.body.verificationLevel || 'signed_receipt'
    });
    const assignmentResult = await assignJob({ store, job, policy: validation.policy });
    if (!assignmentResult.ok) {
      return res.status(202).json({ job: store.getJob(job.jobId), assignment: null, reason: assignmentResult.reason });
    }
    res.json({ job: store.getJob(job.jobId), assignment: assignmentResult.assignment });
  });

  router.get('/jobs/:jobId', (req, res) => {
    store.expireStaleAssignments();
    const job = store.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'job not found' });
    res.json({ job });
  });

  router.post('/assignments/:assignmentId/receipt', async (req, res) => {
    const assignment = store.getAssignment(req.params.assignmentId);
    if (!assignment) return res.status(404).json({ error: 'assignment not found' });
    const receipt = req.body?.receipt;
    const outputText = req.body?.outputText || '';
    const tokenIds = Array.isArray(req.body?.tokenIds) ? req.body.tokenIds : [];
    const transcript = req.body?.transcript || { outputText, tokenIds };
    const decision = await verifyReceipt({
      store,
      assignment,
      receipt,
      outputText,
      tokenIds,
      transcript
    });
    const receiptRecord = store.saveReceipt(decision.receiptHash, {
      assignmentId: assignment.assignmentId,
      jobId: assignment.jobId,
      providerId: assignment.providerId,
      requesterId: assignment.requesterId,
      outputText,
      tokenIds,
      transcript,
      receipt,
      verifierDecision: decision
    });
    store.updateAssignment(assignment.assignmentId, {
      status: decision.accepted ? 'receipt_verified' : 'receipt_rejected',
      receiptHash: decision.receiptHash
    });
    store.setProviderStatus(assignment.providerId, 'available');
    store.updateJob(assignment.jobId, {
      status: decision.accepted ? 'receipt_verified' : 'receipt_rejected',
      receiptHash: decision.receiptHash,
      outputText,
      verifierDecision: decision
    });
    if (!decision.accepted) {
      recordRejectedReceipt({
        store,
        providerId: assignment.providerId,
        reasons: decision.reasons
      });
    }
    res.status(decision.accepted ? 200 : 400).json({ receipt: receiptRecord, verifierDecision: decision });
  });

  router.post('/receipts/:receiptHash/accept', async (req, res) => {
    const receiptRecord = store.getReceipt(req.params.receiptHash);
    if (!receiptRecord) return res.status(404).json({ error: 'receipt not found' });
    if (!receiptRecord.verifierDecision?.accepted) {
      return res.status(400).json({ error: 'receipt is not verifier-accepted' });
    }
    const acceptancePayload = {
      ...req.body,
      accepted: req.body?.accepted === true,
      requesterId: req.body?.requesterId || receiptRecord.requesterId
    };
    const job = store.getJob(receiptRecord.jobId);
    const acceptanceDecision = await verifyRequesterAcceptance({
      job,
      acceptance: acceptancePayload
    });
    if (!acceptanceDecision.accepted) {
      return res.status(400).json({
        error: 'requester acceptance rejected',
        verifierDecision: acceptanceDecision
      });
    }
    const acceptance = store.saveAcceptance(req.params.receiptHash, acceptancePayload);
    if (acceptance.accepted !== true) {
      store.updateJob(receiptRecord.jobId, {
        status: 'rejected_by_requester',
        requesterAcceptance: acceptance
      });
      return res.json({ acceptance, ledgerEvent: null, reputation: store.getReputation(receiptRecord.providerId) });
    }
    const ledgerEvent = awardAcceptedReceipt({ store, receiptRecord, acceptance });
    const reputation = recordAcceptedReceipt({
      store,
      providerId: receiptRecord.providerId,
      points: ledgerEvent.points
    });
    store.updateJob(receiptRecord.jobId, {
      status: 'accepted',
      requesterAcceptance: acceptance,
      ledgerEvent
    });
    res.json({ acceptance, ledgerEvent, reputation });
  });

  router.get('/receipts/:receiptHash', (req, res) => {
    const receipt = store.getReceipt(req.params.receiptHash);
    if (!receipt) return res.status(404).json({ error: 'receipt not found' });
    res.json(receipt);
  });

  router.get('/points/:userId', (req, res) => {
    const events = store.listLedger(req.params.userId);
    const total = events.reduce((sum, event) => sum + Number(event.points || 0), 0);
    res.json({ userId: req.params.userId, total, events });
  });

  router.get('/reputation/:providerId', (req, res) => {
    res.json(store.getReputation(req.params.providerId));
  });

  return router;
}

export default createPoolRouter;
