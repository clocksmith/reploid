/* global __nativePartitionFixture, encodeBytes, resident, settleMemory */
/** Opt-in ordered branch of the existing installed-runtime physical reference fixture. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { preparePartitionMemory } from './prepare-partition-memory.js';
import { bindPairedPartitionFixture } from './paired-partition-binding.js';
import { verifyNumericalTestDelivery } from './numerical-test-delivery.js';
import { observeResidentOpening } from './resident-opening-observer.js';
import { connectNativePartitionEndpoint } from './native-partition-endpoint.js';
import { createConcurrentOperationObserver } from './concurrent-partition-memory.js';
import { assertPartitionMemorySettlement } from './partition-memory-settlement.js';
import { decodeReferenceLogits } from './independent-numerical-reference.js';
import referenceContract from './distributed-reference-contract.json' with { type: 'json' };
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const readBound = async entry => { const bytes = await readFile(entry.path); assert.equal(sha(bytes), entry.hash, `Bound file changed: ${entry.path}`); return bytes; };

export function validateOrderedCaptureConfiguration(config, expected) {
  assert.equal(config.schema, 'reploid.ordered-qualification-capture/v1');
  assert.equal(expected.schema, 'doppler.physical-resident-producer-input/v2');
  assert.equal(expected.deliveryMode, 'direct-fixture');
  assert.deepEqual(expected.deadlines, { stageMs: 300000, cleanupMs: 10000, observationMs: 2000 });
  assert.equal(expected.maxGpuBufferBytes, 1420000000);
  assert.equal(config.executors.length, expected.logicalStageCount);
  assert.equal(expected.partitionPlan.stageCount, expected.logicalStageCount);
  assert.deepEqual(expected.placements.map(p => p.partitionIndex), config.executors.map((executor, index) => {
    assert(['browser-cdp', 'native-inspector'].includes(executor.kind));
    assert.equal(executor.executorId, expected.placements[index].executorId);
    assert.equal(typeof executor.endpoint, 'string'); assert(executor.endpoint.length);
    assert.equal(typeof executor.modelSource, 'string'); assert(executor.modelSource.endsWith('/'));
    return index;
  }));
  assert.equal(new Set(config.executors.map(row => row.endpoint)).size, config.executors.length, 'Distinct owned endpoints required');
  assert.equal(new Set(expected.placements.map(row => row.platform)).size, expected.physicalHostCount);
  assert.equal(config.outputPath.endsWith('.json'), true);
  assert.equal(config.gpuReservation?.approved, true, 'Explicit root GPU reservation required before launch');
  assert(config.gpuReservation.id && config.gpuReservation.observedAt && config.gpuReservation.sharedMachineNotes);
}

/** Serialized directly into the owned executor. Values come from actual executeStage. */
export async function executeOrderedPhysicalStage({ parameters, activationInput, continuation }) {
  const decode = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));
  const bytesHash = async bytes => 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('');
  const activation = activationInput ? { ...activationInput, tensorData: new Float32Array(decode(activationInput.data).buffer) } : undefined;
  const value = await resident.executeStage({ ...parameters, ...(activation ? { activation } : {}), continuation, signal: new AbortController().signal });
  const activationOutput = value.activationTensor ? { ...value.activationTensor, data: encodeBytes(value.activationTensor.data),
    byteLength: value.activationTensor.data.byteLength, storageHash: await bytesHash(value.activationTensor.data) } : null;
  return { identity: value.identity, partitionIndex: value.partitionIndex, step: value.step, tokenPosition: value.tokenPosition,
    activationOutput, continuation: value.continuation, tokenId: value.tokenId, delta: value.delta, done: value.done,
    stopReason: value.stopReason, logits: value.logits ? encodeBytes(value.logits) : null };
}

export async function captureOrderedReferenceRuns({ pages, expected, reference, runtime, evaluate, evidence, persist, requestContracts }) {
  for (let attempt = 0; attempt < reference.expected.length; attempt++) {
    const identity = { schema: 'doppler.resident-partition-attempt/v2', modelId: expected.partitionPlan.modelId,
      modelIdentity: expected.manifestHash, planId: expected.orderedContract.partitionPlanHash,
      requesterId: expected.requesterId, placementGeneration: expected.placementGeneration,
      threadId: `ordered-reference-${attempt}`, attemptId: `ordered-reference-${attempt}`,
      stages: expected.placements.map(({ partitionIndex: index, participantId, transportId, residentId, executionId }) =>
        ({ index, participantId, transportId, residentId, executionId })) };
    const row = { attempt, identity, generation: reference.generation, text: '', steps: 0, completed: false, numerical: [] };
    evidence.runs.push(row);
    const continuations = pages.map(() => null), target = reference.expected[attempt];
    try {
      const tokenized = await evaluate(pages[0], `tokenize-${attempt}`, ({ identity, messages }) =>
        resident.tokenize({ identity, messages, signal: new AbortController().signal }), { identity, messages: reference.prompts[attempt] });
      let ids = tokenized.tokenIds, position = 0;
      assert.deepEqual(ids, requestContracts[attempt].inputIds.slice(0, requestContracts[attempt].prefixLengths[0]), 'Tokenized original prompt differs');
      row.inputTokens = ids.length;
      for (let step = 0; step < target.steps.length; step++) {
        const numerical = { step, inputTokenIds: [...ids], stageExecutions: [] }; row.numerical.push(numerical);
        let activationInput = null, result;
        for (let index = 0; index < pages.length; index++) {
          const parameters = { identity, partitionIndex: index, step, tokenPosition: position, inputTokenCount: ids.length,
            inputTokenIds: ids, generation: reference.generation, generationDigest: runtime.hashPartitionGeneration(reference.generation),
            maxTokens: reference.generation.maxTokens };
          const started = performance.now();
          result = await evaluate(pages[index], `request-${attempt}:step-${step}:stage-${index}`, executeOrderedPhysicalStage,
            { parameters, activationInput, continuation: continuations[index] });
          const execution = { ...parameters, identity: result.identity, partitionIndex: result.partitionIndex,
            step: result.step, tokenPosition: result.tokenPosition, executorId: expected.placements[index].executorId,
            initialExecutionIdentityHash: runtime.computeCanonicalSha256(evidence.descriptors[index].openingObservation.initialExecutionIdentity),
            method: 'executeStage', completed: true, elapsedMs: performance.now() - started,
            activationInput, activationOutput: result.activationOutput, logitsHash: result.logits ? sha(Buffer.from(result.logits, 'base64')) : null };
          numerical.stageExecutions.push(execution);
          continuations[index] = result.continuation; activationInput = result.activationOutput;
          assert.deepEqual(result.identity, identity); assert.equal(result.partitionIndex, index);
          assert.equal(result.step, step); assert.equal(result.tokenPosition, position);
          assert.equal(Boolean(result.logits), index === pages.length - 1, 'Only final stage supplies logits');
          await persist();
        }
        Object.assign(numerical, { logits: result.logits, tokenId: result.tokenId, stopReason: result.stopReason });
        const raw = Buffer.from(result.logits, 'base64'), actual = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
        const independent = decodeReferenceLogits(target.steps[step]);
        assert.equal(actual.length, independent.length);
        let maxDifference = 0;
        for (let index = 0; index < actual.length; index++) {
          assert(Number.isFinite(actual[index])); maxDifference = Math.max(maxDifference, Math.abs(actual[index] - independent[index]));
        }
        numerical.maxDifference = maxDifference; assert(maxDifference <= 0.001, 'Independent F64 tolerance failed');
        assert.equal(result.tokenId, target.steps[step].tokenId); assert.equal(result.stopReason, target.steps[step].stopReason);
        row.text += result.delta; row.steps++;
        position += ids.length; ids = [target.steps[step].tokenId];
        assert.equal(result.done, step + 1 === target.steps.length);
      }
      assert.equal(row.text, target.text); row.stopReason = 'eos-token'; row.completed = true;
    } catch (error) { row.error = { name: error.name, message: error.message }; throw error; }
    finally {
      row.attemptSettlement = await Promise.all(pages.map(async (page, index) => {
        try { await evaluate(page, `close-attempt-${attempt}-${index}`, identity => resident.closeAttempt({ identity }), identity, true);
          return { index, closed: true }; }
        catch (error) { return { index, closed: false, error: error.message, ownership: 'unknown' }; }
      }));
      await persist();
      if (row.attemptSettlement.some(result => !result.closed) && !row.error) throw Error('Ordered attempt ownership did not settle');
    }
  }
}

export async function runOrderedPartitionReference(configPath) {
  const config = JSON.parse(await readFile(configPath));
  const expectedBytes = await readBound(config.expectations), expected = JSON.parse(expectedBytes);
  validateOrderedCaptureConfiguration(config, expected);
  const [referenceBytes, manifestBytes, graphBytes, archiveBytes, policyBytes, pairedBytes, requestBytes] = await Promise.all([
    readBound(config.reference), readBound(config.manifest), readBound(config.graph), readBound(config.archive),
    readBound(config.policy), readBound(config.pairedBinding), readBound(config.requests),
  ]);
  assert.equal(sha(referenceBytes), expected.referenceHash); assert.equal(sha(manifestBytes), expected.manifestHash);
  assert.equal(sha(graphBytes), expected.graphHash); assert.equal(sha(archiveBytes), expected.archiveHash);
  assert.equal(sha(requestBytes).slice(7), expected.requestFixtureSha256);
  const reference = JSON.parse(referenceBytes), policy = JSON.parse(policyBytes), manifest = JSON.parse(manifestBytes);
  assert.equal(reference.numericalReference.proposalSha256, referenceContract.independent.proposal.sha256);
  assert.equal(reference.numericalReference.outputIndexSha256, referenceContract.independent.index.sha256);
  assert.equal(reference.numericalReference.kind, 'independent-f64'); assert.equal(reference.numericalReference.steps, 55);
  assert.equal(reference.numericalReference.tolerance, 0.001); assert.equal(policy.maxGpuBufferBytes, 1420000000);
  const pairedBinding = await bindPairedPartitionFixture({ bindingBytes: pairedBytes, graphBytes, modelBytes: manifestBytes,
    archiveBytes, referenceIdentity: reference.modelIdentity });
  const testDelivery = await verifyNumericalTestDelivery({ root: config.root, bindingPath: config.delivery.path,
    bindingSha256: config.delivery.hash.slice(7), archivePath: config.archive.path, runtimeDirectory: config.runtimeDirectory });
  assert.equal(testDelivery.testDeliveryHash, expected.testDeliveryHash);
  const runtime = { ...await import(pathToFileURL(resolve(config.runtimeDirectory, 'src/partitions.js'))),
    ...await import(pathToFileURL(resolve(config.runtimeDirectory, 'src/formats/canonical-hash.js'))) };
  runtime.validateOrderedLayerPartitionPlan(manifest, expected.partitionPlan);
  assert.equal(runtime.hashLayerPartitionPlan(expected.partitionPlan), expected.orderedContract.partitionPlanHash);
  const evidence = { schema: 'reploid.ordered-physical-capture/v1', phase: 'reference', scope: 'Actual ordered resident execution with local verified files and controller forwarding; not signed opening or authenticated transport',
    expectationsHash: sha(expectedBytes), gpuReservation: config.gpuReservation, testDelivery, pairedBinding,
    requestFixtureSha256: sha(requestBytes).slice(7), logicalStageCount: expected.logicalStageCount, physicalHostCount: expected.physicalHostCount,
    deadlines: expected.deadlines, descriptors: [], runs: [], residentSettlement: [], executorSettlements: [], nativeHostSettlements: [], operations: {} };
  const requestContracts = await Promise.all(config.requestContracts.map(async (binding, index) => {
    assert.equal(binding.hash, expected.requestContractHashes[index]); return JSON.parse(await readBound(binding));
  }));
  assert.equal(requestContracts.length, reference.expected.length);
  await writeFile(config.outputPath, JSON.stringify(evidence), { flag: 'wx' });
  const owners = [];
  let writing = Promise.resolve(), primary;
  const persist = () => { const bytes = JSON.stringify(evidence); writing = writing.then(() => writeFile(config.outputPath, bytes)); return writing; };
  const evaluate = createConcurrentOperationObserver({ evidence: evidence.operations, persist });
  try {
    for (const [index, executor] of config.executors.entries()) {
      const preflightBytes = await readBound(executor.preflight), preflight = JSON.parse(preflightBytes), placement = expected.placements[index];
      assert.equal(preflight.executorId, executor.executorId); assert.equal(preflight.endpoint, executor.endpoint);
      assert.equal(preflight.platform, placement.platform); assert.deepEqual(preflight.executableIdentity, expected.executables[executor.executorId]);
      assert(Number.isFinite(Date.parse(preflight.observedAt)) && Date.parse(preflight.observedAt) >= Date.parse(config.gpuReservation.observedAt), 'Live preflight predates reservation');
      const native = executor.kind === 'native-inspector';
      const browser = native ? await connectNativePartitionEndpoint(executor.endpoint) : await chromium.connectOverCDP(executor.endpoint);
      const owner = { browser, native, index, executor, closedAttempts: 0, servedSources: [], sourceErrors: [], sourcePending: [] }; owners.push(owner);
      owner.context = await browser.newContext(); owner.page = await owner.context.newPage();
      const { page } = owner;
      let actualPid, contextId;
      if (native) {
        actualPid = browser.identity.pid; contextId = new URL(executor.endpoint).pathname;
        assert.equal(actualPid, preflight.pid);
        const declared = expected.nativeHosts[executor.executorId];
        assert.equal(browser.identity.node, declared.node);
        assert.equal(browser.identity.fixture.runtimeBaseUrl, executor.runtimeBaseUrl);
        assert.equal(browser.identity.fixture.nativeDeliverySha256, declared.nativeDeliverySha256);
        assert.equal(browser.identity.fixture.testDelivery.archiveSha256, expected.archiveHash.slice(7));
        assert.equal(browser.identity.fixture.testDelivery.installedFiles, expected.installedFiles);
        assert.equal(browser.identity.fixture.testDelivery.testDeliveryHash, declared.testDeliveryHash);
        assert.equal(await page.evaluate(() => Boolean(globalThis.resident)), false, 'Native fixture already owns a resident');
        await browser.open();
      } else {
        const session = await browser.newBrowserCDPSession();
        try {
          const info = await session.send('SystemInfo.getProcessInfo');
          actualPid = info.processInfo.find(row => row.type === 'browser')?.id;
          assert.equal(actualPid, preflight.pid, 'Connected browser differs from observed process');
        } finally { await session.detach(); }
        const sessionPage = await owner.context.newCDPSession(page);
        try { contextId = (await sessionPage.send('Target.getTargetInfo')).targetInfo.targetId; }
        finally { await sessionPage.detach(); }
        assert.equal(browser.version(), expected.browserVersions[executor.executorId]);
        // Served package bytes are compared with the independently verified installed archive.
        page.on('response', response => {
          if (!response.url().startsWith(executor.runtimeBaseUrl)) return;
          const task = (async () => {
            const suffix = new URL(response.url()).pathname.slice(new URL(executor.runtimeBaseUrl).pathname.length);
            assert(suffix && !suffix.split('/').includes('..'));
            const actual = await response.body(), frozen = await readFile(resolve(config.runtimeDirectory, 'src', suffix));
            assert.equal(sha(actual), sha(frozen), `Served runtime source differs: ${suffix}`);
            owner.servedSources.push({ path: suffix, sha256: sha(actual) });
          })().catch(error => owner.sourceErrors.push(error.message));
          owner.sourcePending.push(task);
        });
        await page.goto(executor.baseUrl);
      }
      owner.executorIdentity = { pid: actualPid, contextId };
      const observer = await observeResidentOpening(page, { runtimeBaseUrl: executor.runtimeBaseUrl,
        factorySource: await readFile(resolve(config.runtimeDirectory, 'src/client/resident-partitions.js'), 'utf8'),
        identitySource: await readFile(resolve(config.runtimeDirectory, 'src/config/initial-execution-identity.js'), 'utf8') });
      let prepared;
      try {
        prepared = await evaluate(page, `prepare-stage-${index}`, preparePartitionMemory, { model: { ...config.model, generation: reference.generation },
          index, participantId: placement.participantId, orderedPlan: expected.partitionPlan, pairedBinding,
          modelSource: executor.modelSource, policy, config: { DOPPLER_PACKAGE_VERSION: config.packageVersion,
            DOPPLER_PARTITIONS_MODULE_URL: new URL('partitions.js', executor.runtimeBaseUrl).href,
            DOPPLER_KERNEL_BASE_URL: new URL('gpu/kernels/', executor.runtimeBaseUrl).href } });
        prepared.openingObservation = await observer.finish();
      } finally { await observer.close(); }
      const identityHash = runtime.computeCanonicalSha256(prepared.openingObservation.initialExecutionIdentity);
      assert.equal(identityHash, placement.executionId, 'Actual prepared execution differs from frozen route');
      assert.deepEqual(prepared.observedProvider, expected.providers[executor.executorId]);
      assert.equal(prepared.planId, expected.orderedContract.partitionPlanHash);
      assert.equal(prepared.legacyPlanId, reference.planId, 'Independent reference traversal identity changed');
      assert.deepEqual(prepared.plan, expected.partitionPlan);
      evidence.descriptors.push({ ...prepared, platform: placement.platform, executorId: executor.executorId,
        executableIdentity: preflight.executableIdentity, executorIdentity: owner.executorIdentity, preflightHash: sha(preflightBytes),
        ...(native ? { surface: 'node-webgpu', nativePid: browser.identity.pid, node: browser.identity.node, nativeHost: browser.identity.fixture,
          nativeProvider: await page.evaluate(() => __nativePartitionFixture.observeProvider()) }
          : { surface: 'browser-webgpu', browser: browser.version() }) });
      await persist();
    }
    await captureOrderedReferenceRuns({ pages: owners.map(owner => owner.page), expected, reference, runtime, evaluate, evidence, persist, requestContracts });
  } catch (error) { primary = error; evidence.failure = { name: error.name, message: error.message }; }
  finally {
    for (const owner of owners) {
      const { index, executor, page, browser } = owner;
      const settlement = { partitionIndex: index, executorId: executor.executorId, barriers: 0, residentClosed: false,
        attemptsClosed: evidence.runs.filter(row => row.attemptSettlement?.[index]?.closed).length,
        initialExecutionIdentityHash: evidence.descriptors[index]?.openingObservation
          ? runtime.computeCanonicalSha256(evidence.descriptors[index].openingObservation.initialExecutionIdentity) : null };
      evidence.residentSettlement.push(settlement);
      const started = performance.now();
      try {
        settlement.snapshot = await evaluate(page, `close-resident-${index}`, async () => { await globalThis.resident?.close(); return settleMemory(); }, undefined, true);
        settlement.barriers = 1; settlement.residentClosed = true;
        assertPartitionMemorySettlement(settlement.snapshot);
      } catch (error) { settlement.error = error.message; settlement.ownership = 'unknown'; evidence.cleanupFailure ||= error.message; }
      settlement.elapsedMs = performance.now() - started;
      await evaluate({ evaluate: () => Promise.all(owner.sourcePending) }, `source-observation-${index}`, () => {}, undefined, true, false)
        .catch(error => { owner.sourceErrors.push(error.message); });
      const closed = { partitionIndex: index, executorId: executor.executorId, executorIdentity: owner.executorIdentity, contextClosed: false };
      evidence.executorSettlements.push(closed);
      try {
        await evaluate({ evaluate: () => owner.context?.close() }, `close-context-${index}`, () => {}, undefined, true, false);
        closed.contextClosed = true;
        const release = await evaluate({ evaluate: () => browser.close() }, `release-endpoint-${index}`, () => {}, undefined, true, false);
        if (owner.native) evidence.nativeHostSettlements.push({ ...release, executorId: executor.executorId, pid: browser.identity.pid });
      } catch (error) { closed.error = error.message; evidence.cleanupFailure ||= error.message; }
      evidence.servedSources ||= []; evidence.servedSources.push({ executorId: executor.executorId, files: owner.servedSources, errors: owner.sourceErrors });
      if (owner.sourceErrors.length) evidence.cleanupFailure ||= 'Served runtime source identity mismatch';
    }
    await persist();
  }
  if (primary) throw primary;
  assert(!evidence.cleanupFailure, evidence.cleanupFailure);
  return evidence;
}
