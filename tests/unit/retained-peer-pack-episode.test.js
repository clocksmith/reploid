// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { sha256Hex } from '../../self/pool/inference-receipt.js';
import { hashDopplerEvidence, assertPackExecutionEvidence } from '../../self/pool/executable-pack.js';
import { assertPackOperationReceipt } from '../../self/pool/pack-operation.js';

describe.each(['esm2-peer-pack-2026-09-05', 'esm2-pack-operation-2026-09-05'])('retained physical peer Pack episode: %s (offline evidence validation)', (directory) => {
  const ROOT = resolve('docs/status', directory);
  const json = async (path) => JSON.parse(await readFile(resolve(ROOT, path), 'utf8'));
  it('binds retained bytes, completed custody, real operation evidence, and explicit non-claims', async () => {
    const index = await json('index.json');
    for (const file of index.files) {
      const bytes = await readFile(resolve(ROOT, file.path));
      expect(await sha256Hex(bytes), file.path).toBe(file.hash);
      expect(bytes.length, file.path).toBe(file.sizeBytes);
    }
    const report = await json('episode.json');
    const pack = await json('pack/pack.json');
    expect(report.passed).toBe(true);
    expect(report.claimBoundary).toMatchObject({ internalOperatorCount: 1, independentMachines: false, independentOperators: false, historyImprovement: false });
    expect(report.origin).toMatchObject({ disabled: true, rejectedRequests: [], receiverBootstrapRequests: 0 });
    expect(report.receiverCache).toEqual({ databases: [], opfsEntries: [] });
    expect(report.execution.custody.completed).toHaveLength(pack.artifacts.length + 1);
    expect(report.execution.custody.attempts.some((attempt) => attempt.error?.includes('integrity'))).toBe(true);
    expect(report.peers.some((peer) => peer.injectedFaults.some((fault) => fault.type === 'supplier-departure'))).toBe(true);
    expect(report.acceptance.checks).toHaveLength(8);
    expect(report.acceptance.checks.every((check) => check.passed)).toBe(true);
    expect(await hashDopplerEvidence(report.runtimeBootstrap.files)).toBe(index.runtimeSourceSnapshotDigest);
    await assertPackExecutionEvidence(report.binding, report.execution.result.receipt);
    if (directory === 'esm2-pack-operation-2026-09-05') {
      const operation = report.execution.operationExecution;
      expect(operation.request.operation).toEqual({ name: 'encodeSequence', version: 1 });
      expect(operation.eventCount).toBe(1);
      expect(operation.output).toEqual(Object.fromEntries(Object.entries(report.execution.result).filter(([key]) => key !== 'receipt')));
      await assertPackOperationReceipt(report.binding, operation.receipt, { request: operation.request,
        output: operation.output, runtimeVersion: report.config.dopplerVersion });
    }
    for (const artifact of pack.artifacts) {
      const entry = artifact.role === 'weight-shard'
        ? index.externalArtifacts.find((item) => item.artifactId === artifact.artifactId)
        : index.files.find((item) => item.path === `pack/${artifact.path}`);
      expect(entry, artifact.artifactId).toMatchObject({ hash: artifact.hash, sizeBytes: artifact.sizeBytes });
    }
  });
});
