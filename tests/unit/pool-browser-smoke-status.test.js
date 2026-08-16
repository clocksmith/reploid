import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BROWSER_QUALIFICATION_CHECKS } from '../../self/pool/browser-qualification.js';
import { exactModelContractKey, getPoolModelContract } from '../../self/pool/model-contract.js';

const status = JSON.parse(await readFile(
  resolve('docs/status/esm2-35m-poolday-browser-smoke-2026-08-15.json'),
  'utf8'
));
const cancellationStatus = JSON.parse(await readFile(
  resolve('docs/status/esm2-35m-poolday-cancellation-smoke-2026-08-15.json'),
  'utf8'
));
const corruptionStatus = JSON.parse(await readFile(
  resolve('docs/status/esm2-35m-poolday-corruption-smoke-2026-08-15.json'),
  'utf8'
));
const staleResultStatus = JSON.parse(await readFile(
  resolve('docs/status/esm2-35m-poolday-stale-result-smoke-2026-08-15.json'),
  'utf8'
));
const interruptionRecoveryStatus = JSON.parse(await readFile(
  resolve('docs/status/esm2-35m-poolday-interruption-recovery-smoke-2026-08-15.json'),
  'utf8'
));
const interruptionRetryStatus = JSON.parse(await readFile(
  resolve('docs/status/esm2-35m-poolday-interruption-retry-smoke-2026-08-15.json'),
  'utf8'
));
const cachedShardRecoveryStatus = JSON.parse(await readFile(
  resolve('docs/status/esm2-35m-poolday-cached-shard-recovery-smoke-2026-08-15.json'),
  'utf8'
));
const model = getPoolModelContract('esm2-t12-35m-ur50d-f32-af32');
const contractKeyHash = `sha256:${createHash('sha256').update(exactModelContractKey(model)).digest('hex')}`;

describe('Poolday persisted ESM-2 browser smoke status', () => {
  it('retains exact-model observations without granting qualification', () => {
    expect(status).toMatchObject({
      schema: 'poolday.browser_qualification_smoke_summary/v1',
      status: 'incomplete',
      release: {
        sourceDirty: true,
        qualificationEligible: false
      },
      model: {
        modelId: model.modelId,
        modelHash: model.modelHash,
        manifestHash: model.manifestHash,
        tokenizerHash: model.tokenizerHash,
        shardSetHash: model.artifactIdentity.shardSetHash,
        exactModelContractKeyHash: contractKeyHash
      }
    });
    expect(Object.keys(status.checks).sort()).toEqual([...BROWSER_QUALIFICATION_CHECKS].sort());
    expect(Object.entries(status.checks).filter(([, state]) => state === 'observed').map(([check]) => check).sort()).toEqual([
      'completeHashVerification',
      'immutableArtifactDelivery',
      'opfsPersistence',
      'opfsRestoration',
      'receiptIntegrity',
      'webGpuExecution'
    ]);
    expect(status.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining('clean source revision'),
      expect.stringContaining('independently operated browser reproductions')
    ]));
  });

  it('preserves actual after-start cancellation without claiming backend abort or qualification', () => {
    expect(cancellationStatus).toMatchObject({
      schema: 'poolday.actual_browser_cancellation_smoke_summary/v1',
      status: 'observed',
      qualificationEligible: false,
      release: { sourceDirty: true },
      model: {
        modelId: model.modelId,
        modelHash: model.modelHash,
        manifestHash: model.manifestHash
      },
      probe: {
        mode: 'after_start',
        executionStartObserved: true,
        abortSignalRequested: true,
        sessionAbortMethodAvailable: false,
        receiptPublished: false,
        backendAbortConfirmed: false
      }
    });
    expect(cancellationStatus.producer.attachmentSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(cancellationStatus.claimBoundary).toContain('does not prove');
  });

  it('preserves manifest corruption rejection without claiming shard recovery or qualification', () => {
    expect(corruptionStatus).toMatchObject({
      schema: 'poolday.actual_browser_corruption_rejection_smoke_summary/v1',
      status: 'observed',
      qualificationEligible: false,
      release: { sourceDirty: true },
      model: {
        modelId: model.modelId,
        modelHash: model.modelHash,
        manifestHash: model.manifestHash
      },
      probe: {
        originalTextHash: model.manifestHash,
        forgedSelfDeclaredManifestHash: model.manifestHash,
        rejectionCode: 'model_artifact_unavailable',
        providerAdvertised: false,
        shardRequested: false
      }
    });
    expect(corruptionStatus.probe.corruptedTextHash).not.toBe(model.manifestHash);
    expect(corruptionStatus.claimBoundary).toContain('does not establish shard-corruption recovery');
  });

  it('preserves actual stale-result rejection without treating the probe barrier as production qualification', () => {
    expect(staleResultStatus).toMatchObject({
      schema: 'poolday.actual_browser_stale_result_rejection_smoke_summary/v1',
      status: 'observed',
      qualificationEligible: false,
      release: { sourceDirty: true },
      model: {
        modelId: model.modelId,
        modelHash: model.modelHash,
        manifestHash: model.manifestHash
      },
      probe: {
        mode: 'after_backend_result_before_release',
        resultReleaseBarrier: 'qualification_probe',
        settlementStatus: 'stale_result_rejected',
        errorName: 'StaleResultError',
        errorCode: 'pool_runtime_stale_result',
        receiptPublished: false
      }
    });
    expect(staleResultStatus.claimBoundary).toContain('not a clean-release qualification check');
    expect(staleResultStatus.claimBoundary).toContain('not an uninstrumented production run');
  });

  it('preserves after-start requester interruption as an explicit decision without claiming resume', () => {
    expect(interruptionRecoveryStatus).toMatchObject({
      schema: 'poolday.actual_browser_interruption_recovery_smoke_summary/v1',
      status: 'observed',
      qualificationEligible: false,
      release: { sourceDirty: true },
      model: {
        modelId: model.modelId,
        modelHash: model.modelHash,
        manifestHash: model.manifestHash
      },
      probe: {
        mode: 'after_provider_execution_start',
        sequenceLength: 1000,
        executionStartObserved: true,
        providerStatusBeforeReload: 'Computing',
        providerStatusAfterReload: 'Computing',
        recoveryCode: 'peer_request_interrupted',
        automaticRetry: false,
        userDecisionRequired: true,
        userDecision: 'discarded',
        lateResultPublishedInReloadedPage: false
      }
    });
    expect(interruptionRecoveryStatus.producer.attachmentSha256)
      .toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(interruptionRecoveryStatus.claimBoundary)
      .toContain('not a clean-release browser qualification check');
    expect(interruptionRecoveryStatus.remainingQualificationBoundary)
      .toContain('this observation exercises discard; explicit retry is preserved in a separate actual-browser observation');
  });

  it('preserves explicit interruption retry as a distinct serialized assignment', () => {
    expect(interruptionRetryStatus).toMatchObject({
      schema: 'poolday.actual_browser_interruption_retry_smoke_summary/v1',
      status: 'observed',
      qualificationEligible: false,
      release: { sourceDirty: true },
      model: {
        modelId: model.modelId,
        modelHash: model.modelHash,
        manifestHash: model.manifestHash
      },
      probe: {
        mode: 'explicit_retry_after_provider_execution_start',
        sequenceLength: 1024,
        executionStartObserved: true,
        recoveryCode: 'peer_request_interrupted',
        automaticRetry: false,
        userDecision: 'retry',
        distinctAssignment: true,
        retryQueuedBehindInterruptedExecution: true,
        queueStatusObserved: true,
        executionStartedStatusObserved: true,
        deliveryPolicy: {
          queueWindowMs: 600000,
          receiptWindowMs: 600000,
          queueDeadlineStartsOn: 'provider_queued_status',
          receiptDeadlineStartsOn: 'input_dispatch_or_provider_execution_started'
        },
        retriedAgreementAccepted: true,
        retriedRequesterAccepted: true
      }
    });
    expect(interruptionRetryStatus.probe.interruptedAssignmentId)
      .not.toBe(interruptionRetryStatus.probe.retriedAssignmentId);
    expect(interruptionRetryStatus.probe.retriedReceiptHash)
      .toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(interruptionRetryStatus.claimBoundary).toContain('not automatic resume');
    expect(interruptionRetryStatus.claimBoundary).toContain('not provider-signed receipts');
  });

  it('preserves actual cached-shard recovery without granting release qualification', () => {
    expect(cachedShardRecoveryStatus).toMatchObject({
      schema: 'poolday.actual_browser_cached_shard_recovery_smoke_summary/v1',
      status: 'observed',
      qualificationEligible: false,
      release: { sourceDirty: true },
      model: {
        modelId: model.modelId,
        modelHash: model.modelHash,
        manifestHash: model.manifestHash,
        tokenizerHash: model.tokenizerHash
      },
      probe: {
        mutatedPath: 'shard_00000.bin',
        hashAlgorithm: 'blake3',
        cachePreflightStatus: 'invalidated',
        cacheInvalidated: true,
        recoverySource: 'immutable-source-http',
        recoveryShardRequests: 2,
        outputRestored: true,
        receiptsDistinct: true,
        recoveredAgreementAccepted: true,
        recoveredRequesterAccepted: true
      }
    });
    expect(cachedShardRecoveryStatus.producer.attachmentSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(cachedShardRecoveryStatus.probe.mutatedHash)
      .not.toBe(cachedShardRecoveryStatus.probe.expectedHash);
    expect(cachedShardRecoveryStatus.probe.recoveredOutputHash)
      .toBe(cachedShardRecoveryStatus.probe.baselineOutputHash);
    expect(cachedShardRecoveryStatus.probe.recoveredReceiptHash)
      .not.toBe(cachedShardRecoveryStatus.probe.baselineReceiptHash);
    expect(cachedShardRecoveryStatus.claimBoundary)
      .toContain('not a clean-release browser qualification check');
  });
});
