// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { sha256Hex } from '../../self/pool/inference-receipt.js';
import { hashDopplerEvidence, assertPackExecutionEvidence } from '../../self/pool/executable-pack.js';
import { assertPackOperationReceipt } from '../../self/pool/pack-operation.js';
import { verifyPackPeerEpisode } from '../../self/pool/peer-pack-episode.js';

describe.each(['esm2-peer-pack-2026-09-05', 'esm2-pack-operation-2026-09-05', 'esm2-durable-peer-2026-09-06',
  'esm2-process-restart-2026-09-06', 'esm2-remote-operation-2026-09-06'])('retained physical peer Pack episode: %s (offline evidence validation)', (directory) => {
  const ROOT = resolve('docs/status', directory);
  const json = async (path) => JSON.parse(await readFile(resolve(ROOT, path), 'utf8'));
  it('binds retained bytes, completed custody, real operation evidence, and explicit non-claims', async () => {
    const index = await json('index.json');
    const ignored = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
      input: index.files.map(file => resolve(ROOT, file.path)).join('\n') + '\n', encoding: 'utf8'
    });
    expect(ignored.status, ignored.stdout || ignored.stderr).toBe(1);
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
    const transferAttempts = [...(report.restart?.interrupted.custody.attempts ?? []), ...report.execution.custody.attempts];
    expect(transferAttempts.some((attempt) => attempt.error?.includes('integrity'))).toBe(true);
    expect(report.peers.some((peer) => peer.injectedFaults.some((fault) => fault.type === 'supplier-departure'))).toBe(true);
    expect(report.acceptance.checks).toHaveLength(8);
    expect(report.acceptance.checks.every((check) => check.passed)).toBe(true);
    expect(await hashDopplerEvidence(report.runtimeBootstrap.files)).toBe(index.runtimeSourceSnapshotDigest);
    await assertPackExecutionEvidence(report.binding, report.execution.result.receipt);
    if (directory !== 'esm2-peer-pack-2026-09-05') {
      const operation = report.execution.operationExecution;
      expect(operation.request.operation).toEqual({ name: 'encodeSequence', version: 1 });
      expect(operation.eventCount).toBe(1);
      if (directory === 'esm2-durable-peer-2026-09-06' || report.restart || report.remoteOperation) {
        await assertPackExecutionEvidence(report.binding, operation.output.receipt);
        expect({ ...operation.output, receipt: operation.receipt }).toEqual(report.execution.result);
      } else {
        expect(operation.output).toEqual(Object.fromEntries(Object.entries(report.execution.result).filter(([key]) => key !== 'receipt')));
      }
      await assertPackOperationReceipt(report.binding, operation.receipt, { request: operation.request,
        output: operation.output, runtimeVersion: report.config.dopplerVersion });
    }
    if (directory === 'esm2-durable-peer-2026-09-06' || report.restart) {
      const custody = report.execution.custody;
      expect(custody.maxConcurrentChunks).toBe(2);
      expect(custody.peakInFlightBytes).toBeGreaterThan(report.config.chunkBytes);
      expect(custody.storage).toMatchObject({ storage: 'indexeddb', chunks: 149 });
      expect(custody.storage.storedBytes).toBe(custody.persistedBytes + (report.restart?.interrupted.custody.persistedBytes ?? 0));
      expect(custody.storage.storedBytes).toBeLessThanOrEqual(custody.storage.maxBytes);
      expect(custody.timeToRunnableMs).toBeGreaterThan(0);
      expect(custody.duplicateBytes).toBe(0);
      expect((await json('attachments/episode.json')).passed).toBe(false);
    }
    if (report.restart) {
      const software = await json('runtime-package-equivalence.json');
      expect(software.passed).toBe(true);
      expect(software.package).toEqual(report.installedPackage);
      expect(software.package.sha256).toBe('95d722c5d3ae10b60e78cd9c8c2ce3a769ecb39229c7f25c1d26a8bf7bee6b10');
      expect(software.files).toEqual(report.runtimeBootstrap.files.filter(row => row.path.startsWith('/doppler/src/')));
      const restart = report.restart;
      expect(restart).toMatchObject({ previousProcessExited: true, resumed: true, refetchedVerifiedChunks: 0 });
      expect(restart.afterPid).not.toBe(restart.beforePid);
      expect(restart.interrupted.passed).toBe(false);
      expect(restart.interrupted.injectedDisconnection.weightResponses).toBeGreaterThanOrEqual(report.config.restart.afterWeightResponses);
      expect(restart.interrupted.custody.storage.storedBytes).toBeGreaterThan(report.config.chunkBytes);
      expect(restart.interrupted.custody.completed.length).toBeLessThan(pack.artifacts.length + 1);
      const accepted = restart.interrupted.custody.attempts.filter(row => row.status === 'accepted');
      const fetched = new Set(report.execution.custody.attempts.map(row => `${row.artifactId}:${row.chunkIndex}`));
      expect(accepted.length).toBeGreaterThan(0);
      expect(accepted.every(row => !fetched.has(`${row.artifactId}:${row.chunkIndex}`))).toBe(true);
      expect(report.execution.custody.cacheBytes).toBeGreaterThanOrEqual(restart.interrupted.custody.storage.storedBytes);
      // The first attempt exposed an assertion that ignored corruption before restart.
      // Its numerical execution and recovery passed; the overall recorded failure remains.
      const first = await json('attachments/episode.json');
      expect(first.acceptance.passed).toBe(true);
      expect(first.restart.resumed).toBe(true);
      expect(first.restart.interrupted.custody.attempts.some(row => row.error?.includes('integrity'))).toBe(true);
      expect(first.execution.custody.attempts.some(row => row.error?.includes('integrity'))).toBe(false);
    }
    if (report.remoteOperation) {
      const remote = report.remoteOperation;
      const reference = await json('attachments/remote-reference.json');
      expect(await sha256Hex(await readFile(resolve(ROOT, 'attachments/remote-reference.json')))).toBe(report.config.remoteOperation.referenceDigest);
      const verified = await verifyPackPeerEpisode({ ...remote, reference: reference.output, models: [remote.job.body.intent.model] });
      expect(verified.accepted).toBe(true);
      expect(report.remoteAcceptance.checks).toHaveLength(8);
      expect(report.remoteAcceptance.checks.every(check => check.passed)).toBe(true);
      expect(remote.accounting.deliveries).toBe(2);
      expect(report.remoteProvider).toMatchObject({ calls: 1, droppedCompletions: 1, errors: [],
        executionReceiptDigest: remote.execution.receipt.receiptDigest });
      expect(remote.transport.sentFrameBytes).toBe(report.remoteProvider.transport.receivedFrameBytes);
      expect(remote.transport.receivedFrameBytes).toBe(report.remoteProvider.transport.sentFrameBytes);
      expect(remote.job.fromPeerId).not.toBe(remote.job.toPeerId);
      const software = await json('attachments/runtime-package-equivalence.json');
      expect(software.passed).toBe(true);
      expect(software.package).toEqual(report.installedPackage);
      expect(software.files).toEqual(report.runtimeBootstrap.files.filter(row => row.path.startsWith('/doppler/src/')));
      expect((await json('attachments/attempt-02.json')).passed).toBe(false);
      const failed = await json('attachments/attempt-03.json');
      expect(failed.passed).toBe(false);
      expect(failed.remoteProvider.calls).toBe(2);
      expect(failed.remoteProvider.errors.some(error => error.includes('already active'))).toBe(true);
    }
    for (const artifact of pack.artifacts) {
      const entry = artifact.role === 'weight-shard'
        ? index.externalArtifacts.find((item) => item.artifactId === artifact.artifactId)
        : index.files.find((item) => item.path === `pack/${artifact.path}`);
      expect(entry, artifact.artifactId).toMatchObject({ hash: artifact.hash, sizeBytes: artifact.sizeBytes });
    }
  });
});
