import { describe, expect, it } from 'vitest';

import { getPoolModelContract, exactModelContractKey } from '../../self/pool/model-contract.js';
import {
  BROWSER_QUALIFICATION_CHECKS,
  BROWSER_QUALIFICATION_SCHEMA,
  buildBrowserQualificationCheckEvidence,
  buildBrowserQualificationObservation,
  buildBrowserQualificationPlan,
  finalizeBrowserQualificationObservation,
  recordBrowserQualificationCheck,
  validateBrowserQualificationRecord
} from '../../self/pool/browser-qualification.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;
const candidate = getPoolModelContract('amplify-120m-f16-af32');
const candidateKey = exactModelContractKey(candidate);
const checkEvidence = (check, observation) => buildBrowserQualificationCheckEvidence(observation, {
  check,
  browserRunId: `browser-run-${check}`,
  observedAt: '2026-08-01T00:00:00.000Z',
  resultHash: fakeHash('a'),
  artifactHash: fakeHash('b')
});

const qualifiedRecord = () => ({
  schema: BROWSER_QUALIFICATION_SCHEMA,
  status: 'qualified',
  identity: buildBrowserQualificationPlan(candidate, candidateKey).identity,
  release: {
    sourceRevision: 'test-release-source',
    sourceTreeHash: fakeHash('4'),
    browserBundleHash: fakeHash('5')
  },
  browser: { family: 'Chromium', version: '123.0', userAgentHash: fakeHash('6') },
  gpu: { adapterIdentity: 'test-adapter' },
  policyHash: fakeHash('1'),
  outputHash: fakeHash('2'),
  receiptHash: fakeHash('3'),
  artifacts: {
    manifestHash: candidate.manifestHash,
    tokenizerHash: candidate.tokenizerHash,
    shardSetHash: candidate.artifactIdentity.shardSetHash
  },
  requiredChecks: [...BROWSER_QUALIFICATION_CHECKS],
  checks: Object.fromEntries(BROWSER_QUALIFICATION_CHECKS.map((check) => [check, 'passed'])),
  checkEvidence: {},
  independentReproductions: [
    {
      reproductionId: 'run-one', participantId: 'browser-one', browserRunId: 'browser-run-one',
      browserIdentity: 'Chromium/123', observedAt: '2026-08-01T00:00:00.000Z',
      userAgentHash: fakeHash('7'), gpuAdapterIdentity: 'test-adapter-one', resultHash: fakeHash('8'),
      outputHash: fakeHash('2'), receiptHash: fakeHash('3'),
      bindings: {
        modelHash: candidate.modelHash, manifestHash: candidate.manifestHash, tokenizerHash: candidate.tokenizerHash,
        shardSetHash: candidate.artifactIdentity.shardSetHash, runtime: candidate.runtime, backend: candidate.backend,
        exactModelContractKey: candidateKey, sourceTreeHash: fakeHash('4'), browserBundleHash: fakeHash('5'), policyHash: fakeHash('1')
      }
    },
    {
      reproductionId: 'run-two', participantId: 'browser-two', browserRunId: 'browser-run-two',
      browserIdentity: 'Firefox/124', observedAt: '2026-08-01T00:00:01.000Z',
      userAgentHash: fakeHash('9'), gpuAdapterIdentity: 'test-adapter-two', resultHash: fakeHash('a'),
      outputHash: fakeHash('2'), receiptHash: fakeHash('3'),
      bindings: {
        modelHash: candidate.modelHash, manifestHash: candidate.manifestHash, tokenizerHash: candidate.tokenizerHash,
        shardSetHash: candidate.artifactIdentity.shardSetHash, runtime: candidate.runtime, backend: candidate.backend,
        exactModelContractKey: candidateKey, sourceTreeHash: fakeHash('4'), browserBundleHash: fakeHash('5'), policyHash: fakeHash('1')
      }
    }
  ]
});

const qualifiedRecordWithEvidence = () => {
  const record = qualifiedRecord();
  record.checkEvidence = Object.fromEntries(BROWSER_QUALIFICATION_CHECKS.map((check) => [check, checkEvidence(check, record)]));
  return record;
};

describe('Poolday browser model qualification contract', () => {
  it('binds every required authentic-browser check to one exact model contract', () => {
    const record = qualifiedRecordWithEvidence();
    expect(validateBrowserQualificationRecord(record, {
      model: candidate,
      exactModelContractKey: candidateKey
    })).toEqual({ ok: true, reasons: [] });
  });

  it('derives the qualification key from the model and rejects a transplanted check binding', () => {
    const forgedPlan = buildBrowserQualificationPlan(candidate, 'forged-contract-key');
    expect(forgedPlan.identity.exactModelContractKey).toBe(candidateKey);

    const record = qualifiedRecordWithEvidence();
    record.checkEvidence.webGpuExecution.bindings.exactModelContractKey = 'forged-contract-key';
    expect(validateBrowserQualificationRecord(record, {
      model: candidate,
      exactModelContractKey: candidateKey
    })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'browser qualification check evidence is not bound to exactModelContractKey: webGpuExecution'
      ])
    });
  });

  it('rejects a record with a missing browser recovery check, artifact mismatch, or non-independent reproduction', () => {
    const record = qualifiedRecordWithEvidence();
    record.checks.opfsRestoration = 'missing';
    record.artifacts.tokenizerHash = fakeHash('4');
    record.artifacts.shardSetHash = fakeHash('5');
    record.independentReproductions[1].participantId = record.independentReproductions[0].participantId;
    record.independentReproductions[1].browserRunId = record.independentReproductions[0].browserRunId;
    record.independentReproductions[1].browserIdentity = record.independentReproductions[0].browserIdentity;

    expect(validateBrowserQualificationRecord(record, {
      model: candidate,
      exactModelContractKey: candidateKey
    })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'browser qualification tokenizer hash does not match the exact model contract',
        'browser qualification shard set hash does not match the exact model contract',
        'browser qualification check did not pass: opfsRestoration',
        'browser qualification requires two independent reproductions'
      ])
    });
  });

  it('keeps observations incomplete until every check has browser-run evidence', () => {
    let observation = buildBrowserQualificationObservation({
      model: candidate,
      exactModelContractKey: candidateKey,
      release: {
        sourceRevision: 'test-release-source',
        sourceTreeHash: fakeHash('4'),
        browserBundleHash: fakeHash('5')
      },
      browser: { family: 'Chromium', version: '123.0', userAgentHash: fakeHash('6') },
      gpu: { adapterIdentity: 'test-adapter' },
      policyHash: fakeHash('1'),
      outputHash: fakeHash('2'),
      receiptHash: fakeHash('3'),
      artifacts: {
        manifestHash: candidate.manifestHash,
        tokenizerHash: candidate.tokenizerHash,
        shardSetHash: candidate.artifactIdentity.shardSetHash
      },
      independentReproductions: qualifiedRecord().independentReproductions
    });
    expect(() => recordBrowserQualificationCheck(observation, {
      check: 'webGpuExecution', status: 'passed'
    })).toThrow('requires hash-addressed browser evidence');

    for (const check of BROWSER_QUALIFICATION_CHECKS) {
      observation = recordBrowserQualificationCheck(observation, {
        check,
        status: 'passed',
        evidence: checkEvidence(check, observation)
      });
    }
    const finalized = finalizeBrowserQualificationObservation(observation, {
      model: candidate,
      exactModelContractKey: candidateKey
    });
    expect(finalized.validation).toEqual({ ok: true, reasons: [] });
    expect(finalized.record.status).toBe('qualified');
  });
});
