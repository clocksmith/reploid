/**
 * @fileoverview Evidence and human-approval gates for trained adapters.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import UtilsModule from '../../self/core/utils.js';
import EventBusModule from '../../self/infrastructure/event-bus.js';
import HITLControllerModule from '../../self/infrastructure/hitl-controller.js';
import NeuralCompilerModule, {
  TRAINED_ADAPTER_ADMISSION_SCHEMA,
  verifyTrainedAdapterAdmission
} from '../../self/experimental/intelligence/neural-compiler.js';
import { setSecurityEnabled } from '../../self/core/security-config.js';

const HASHES = Object.freeze({
  artifactIdentity: '1'.repeat(64),
  adapter: '2'.repeat(64),
  base: '3'.repeat(64),
  task: '4'.repeat(64),
  retention: '5'.repeat(64)
});

const stableJson = (value) => {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
};

const hashCore = async (value) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const withHash = async (core, field) => ({ ...core, [field]: await hashCore(core) });

const buildAdmission = async () => {
  const identity = await withHash({
    schema: 'doppler.trainer-artifact-handoff-verification/v1',
    bridgeId: 'bridge.tinker.unit',
    sourceContractId: 'gamma.same-r.tinker.unit',
    artifactKind: 'peft_adapter',
    artifactRole: 'selected_candidate',
    ok: true,
    artifactIdentitySha256: HASHES.artifactIdentity,
    selection: {
      authority: 'clocksmith/gamma',
      status: 'selected',
      receipt: 'same-r.selection-receipt/v1:unit'
    },
    admission: {
      baselineImportAllowed: true,
      parityExecutionAllowed: true,
      candidateCompetitionAllowed: true,
      promotionAllowed: false
    },
    checks: [],
    files: [],
    architecture: {}
  }, 'receiptHash');
  const parity = await withHash({
    schema: 'doppler.trainer-artifact-parity-receipt/v1',
    bridgeId: identity.bridgeId,
    profile: 'tinker_peft_browser_adapter',
    artifactIdentitySha256: HASHES.artifactIdentity,
    identityReceiptHash: identity.receiptHash,
    decision: 'pass',
    blockers: [],
    checkEvidenceHashes: {}
  }, 'receiptHash');
  const gamma = await withHash({
    schema: 'gamma.tinker-browser-selection-receipt/v1',
    evaluationId: 'unit.tinker-browser',
    artifact: {
      adapterId: 'unit-tinker-adapter',
      adapterSha256: HASHES.adapter,
      baseModelId: 'unit-base-model',
      baseCheckpointSha256: HASHES.base,
      trainer: 'thinking-machines/tinker',
      trainingRunId: 'unit-run'
    },
    populations: {
      task: { id: 'task', role: 'sealed_task', sha256: HASHES.task, sampleCount: 2 },
      retention: {
        id: 'retention',
        role: 'sealed_retention',
        sha256: HASHES.retention,
        sampleCount: 2
      }
    },
    evidence: {
      dopplerIdentity: { decision: 'pass', receiptSha256: identity.receiptHash },
      dopplerParity: { decision: 'pass', receiptSha256: parity.receiptHash }
    },
    task: { metricId: 'unit', base: 0.5, candidate: 0.7, gain: 0.2, passed: true },
    retention: {
      metricId: 'unit',
      base: 0.8,
      candidate: 0.8,
      regression: 0,
      passed: true
    },
    determinism: {
      sameDeviceRunToRun: { required: true, passed: true },
      sameDeviceBatchInvariant: { required: true, passed: true },
      crossDeviceNumerical: { required: false, passed: false },
      crossDeviceOutputAgreement: { required: false, passed: true }
    },
    decision: 'gamma_selected',
    blockers: [],
    admission: { candidateCompetitionAllowed: true, promotionAllowed: false },
    claimBoundary: 'Unit fixture only.'
  }, 'receiptSha256');
  const promotionVerification = await withHash({
    schema: 'clocksmith.promotion-verification/v1',
    verifierId: 'clocksmith/ouroboros:promotion-evidence-v1',
    verifiedAt: '2026-07-19T00:00:00.000Z',
    exposureLedgerSchemaSha256: 'sha256:5262a2ed29dd97d163c49f21ab69b54103dc524c68959dc0561defb128fdc038',
    ok: true,
    decision: 'promotion_eligible',
    claimId: 'unit-claim',
    candidate: {
      id: 'unit-tinker-adapter',
      sha256: `sha256:${HASHES.adapter}`
    },
    campaignState: 'confirmed',
    reasons: []
  }, 'receiptHash');
  return {
    schema: TRAINED_ADAPTER_ADMISSION_SCHEMA,
    state: 'shadow',
    dopplerIdentityReceipt: identity,
    dopplerParityReceipt: parity,
    gammaSelectionReceipt: gamma,
    promotionVerification
  };
};

const MANIFEST = Object.freeze({
  id: 'unit-tinker-adapter',
  trainer: 'thinking-machines/tinker',
  adapterSha256: HASHES.adapter,
  baseModel: { id: 'unit-base-model', checkpointSha256: HASHES.base },
  shards: []
});

describe('trained adapter admission', () => {
  let utils;

  beforeEach(() => {
    setSecurityEnabled(false, { persist: false });
    utils = UtilsModule.factory();
  });

  it('binds immutable Doppler and Gamma receipts to the manifest', async () => {
    const verified = await verifyTrainedAdapterAdmission(await buildAdmission(), MANIFEST);
    expect(verified.state).toBe('shadow');
    expect(verified.artifact.adapterSha256).toBe(HASHES.adapter);

    const tampered = await buildAdmission();
    tampered.gammaSelectionReceipt.task.passed = false;
    await expect(verifyTrainedAdapterAdmission(tampered, MANIFEST)).rejects.toThrow(
      'receipt hash mismatch'
    );

    const contaminated = await buildAdmission();
    contaminated.promotionVerification.reasons = ['confirmation input was previously exposed'];
    const contaminatedCore = { ...contaminated.promotionVerification };
    delete contaminatedCore.receiptHash;
    contaminated.promotionVerification.receiptHash = await hashCore(contaminatedCore);
    await expect(verifyTrainedAdapterAdmission(contaminated, MANIFEST)).rejects.toThrow(
      'independent promotion verification'
    );
  });

  it('accepts a Doppler-trained adapter through the Doppler parity profile', async () => {
    const admission = await buildAdmission();
    const manifest = {
      ...MANIFEST,
      trainer: 'clocksmith/doppler'
    };
    admission.dopplerParityReceipt.profile = 'doppler_peft_browser_adapter';
    const parityCore = { ...admission.dopplerParityReceipt };
    delete parityCore.receiptHash;
    admission.dopplerParityReceipt.receiptHash = await hashCore(parityCore);
    admission.gammaSelectionReceipt.evidence.dopplerParity.receiptSha256 = admission.dopplerParityReceipt.receiptHash;
    admission.gammaSelectionReceipt.artifact.trainer = 'clocksmith/doppler';
    const gammaCore = { ...admission.gammaSelectionReceipt };
    delete gammaCore.receiptSha256;
    admission.gammaSelectionReceipt.receiptSha256 = await hashCore(gammaCore);
    const verified = await verifyTrainedAdapterAdmission(admission, manifest);
    expect(verified.artifact.trainer).toBe('clocksmith/doppler');
  });

  it('halts before hashing nonfinite evidence', async () => {
    const admission = await buildAdmission();
    admission.promotionVerification.score = Number.POSITIVE_INFINITY;
    await expect(verifyTrainedAdapterAdmission(admission, MANIFEST)).rejects.toThrow(
      'nonfinite evidence'
    );
  });

  it('queues an always-human request even when global security is autonomous', () => {
    const eventBus = EventBusModule.factory({ Utils: utils });
    const hitl = HITLControllerModule.factory({ Utils: utils, EventBus: eventBus });
    hitl.init();
    const onApprove = vi.fn();
    const approvalId = hitl.requestApproval({
      moduleId: 'NeuralCompiler',
      capability: hitl.CAPABILITIES.APPROVE_TRAINED_ADAPTER,
      action: 'Promote unit adapter',
      data: {},
      alwaysRequireHuman: true,
      onApprove
    });
    expect(approvalId).toBeTruthy();
    expect(onApprove).not.toHaveBeenCalled();
    expect(hitl.approve(approvalId)).toBe(true);
    expect(onApprove).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ source: 'hitl-controller', humanRequired: true })
    );
  });

  it('blocks activation until the queued human promotion completes', async () => {
    const files = new Map();
    const VFS = {
      async read(path) {
        if (!files.has(path)) throw new Error(`not found: ${path}`);
        return files.get(path);
      },
      async write(path, value) {
        files.set(path, value);
      }
    };
    let pendingApproval = null;
    const HITLController = {
      CAPABILITIES: { APPROVE_TRAINED_ADAPTER: 'approve_trained_adapter' },
      registerModule: vi.fn(),
      requestApproval: vi.fn((request) => {
        pendingApproval = request;
        return 'approval-unit';
      })
    };
    const LLMClient = {
      loadLoRAAdapter: vi.fn().mockResolvedValue(true),
      chat: vi.fn().mockResolvedValue({ text: 'ok' })
    };
    const compiler = NeuralCompilerModule.factory({
      Utils: utils,
      EventBus: EventBusModule.factory({ Utils: utils }),
      VFS,
      LLMClient,
      SemanticMemory: { embed: vi.fn().mockResolvedValue([1, 0]) },
      HITLController
    });
    await compiler.init();
    await compiler.stageTrainedAdapter(null, await buildAdmission(), { manifest: MANIFEST });

    await expect(compiler.executeTask({
      adapter: MANIFEST.id,
      model: { id: 'unit' },
      prompt: 'test'
    })).rejects.toThrow('not human-promoted');

    const promotion = compiler.promoteTrainedAdapter(MANIFEST.id);
    expect(pendingApproval.alwaysRequireHuman).toBe(true);
    await pendingApproval.onApprove(pendingApproval.data, {
      approvalId: 'approval-unit',
      approvedAt: Date.now(),
      source: 'hitl-controller',
      humanRequired: true
    });
    const promoted = await promotion;
    expect(promoted.status).toBe('promoted');

    const result = await compiler.executeTask({
      adapter: MANIFEST.id,
      model: { id: 'unit' },
      prompt: 'test'
    });
    expect(result.adapter).toBe(MANIFEST.id);
    expect(LLMClient.loadLoRAAdapter).toHaveBeenCalledOnce();
  });
});
