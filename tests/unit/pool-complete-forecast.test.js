import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSigningKeyPair, exportPublicKey, sha256Hex, hashJson, canonicalize } from '../../self/pool/inference-receipt.js';
import { createForecastIntent, createForecastProviderAdvert, assignForecastJob, validateForecastAssignment,
  createForecastReceipt, verifyForecastReceipt, acceptForecastAgreement, verifyForecastEpisode } from '../../self/pool/complete-forecast.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { validateEnabledPoolModelContract } from '../../self/pool/model-contract.js';
import { sealPeerAssignmentIdentity } from '../../self/pool/peer-assignment.js';

const hash = c => 'sha256:' + c.repeat(64);
async function identity() {
  const pair = await createSigningKeyPair(), publicKey = await exportPublicKey(pair.publicKey);
  return { publicKey, privateKey: pair.privateKey, keyId: await sha256Hex(Uint8Array.from(atob(publicKey), c => c.charCodeAt(0))) };
}

/** Synthetic protocol evidence only; this fixture never claims GPU execution. */
async function fixture({ advertMs = 60000 } = {}) {
  const requester = await identity(), providers = await Promise.all([identity(), identity()]);
  const artifacts = [{ artifactId: 'fixture', hash: await sha256Hex(new Uint8Array([1, 2, 3])), sizeBytes: 3, path: 'fixture.bin', role: 'weight-shard' }];
  const pack = { schema: 'doppler.pack/v3', packId: 'synthetic-protocol-fixture', semanticRoot: hash('a'), envelopeDigest: hash('b'),
    artifactClosureDigest: await hashDopplerEvidence(artifacts) };
  const application = { applicationId: 'synthetic-protocol-test' };
  const model = { modelId: 'synthetic-forecast-fixture', modelHash: pack.semanticRoot, manifestHash: pack.envelopeDigest,
    workload: 'timeseries.forecast.v1', executionMode: 'complete_forecast', runtime: 'doppler', backend: 'browser-webgpu',
    executablePack: { ...pack, requiredOperation: 'forecast', acceptedTargetPlanDigests: [hash('c')], artifacts },
    forecast: { contextLength: 8, maxHorizon: 1, quantiles: [0.1, 0.5, 0.9], applicationDigest: await hashJson(application), contractDigest: hash('d') } };
  const policy = { schema: 'reploid.pool.forecast-policy/v1', id: 'synthetic-agreement', sensitivity: 'public',
    providerIds: providers.map(p => p.keyId), replicas: 2, maxJobMs: 10000, absoluteTolerance: 0.002, relativeTolerance: 0.0002 };
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  const config = { horizon: 1, quantiles: [0.1, 0.5, 0.9], stepMs: 86400000, lastObservation: '2026-09-01T00:00:00.000Z' };
  const intent = await createForecastIntent({ identity: requester, model, domain: { roomId: 'synthetic-room', roomRoot: hash('1'),
    policyHash: hash('2'), runHash: hash('3'), snapshotHash: hash('4') }, config, policy, expiresAt });
  const adverts = await Promise.all(providers.map(provider => createForecastProviderAdvert({ identity: provider, model, expiresAt: new Date(Date.now() + advertMs).toISOString(),
    availability: { acceptingJobs: true, activeJobs: 0, maxConcurrentJobs: 1, maxJobMs: 10000, expectedLatencyMs: null } })));
  const planned = await assignForecastJob({ intent, adverts, expectedModel: model, assignmentAttemptId: 'attempt-1' });
  async function execute(assignment, lastQuantile = 12) {
    const provider = providers.find(p => p.keyId === assignment.providerId);
    const request = { application, context: [1, 2, 3, 4, 5, 6, 7, 8], horizon: 1, assignmentHash: await hashDopplerEvidence(assignment) };
    const output = { timestamps: ['2026-09-02T00:00:00.000Z'], point: [11], quantiles: [[10, 11, lastQuantile]] };
    const receiptPayload = { schema: 'doppler.pack-execution-receipt/v1', operation: 'forecast', pack, targetPlanDigest: hash('c'),
      artifactReceipts: artifacts.map(({ artifactId, hash, sizeBytes }) => ({ artifactId, hash, sizeBytes })),
      assignmentHash: request.assignmentHash, inputHash: await hashDopplerEvidence(request),
      outputHash: await hashDopplerEvidence({ horizon: 1, quantileLevels: config.quantiles, layout: 'time-quantile', values: output.quantiles.flat() }) };
    const executionReceipt = { ...receiptPayload, receiptDigest: await hashDopplerEvidence(receiptPayload) };
    const receipt = await createForecastReceipt({ identity: provider, assignment, request, output, executionReceipt,
      costs: { durationMs: 1, preparationMs: 0, inputBytes: 64, outputBytes: 24, modelBytes: 3, retries: 0, replicas: 1, verificationMs: 0, relayBytes: null, energyJoules: null } });
    return { assignment, request, receipt, route: planned.route, advert: adverts.find(a => a.fromPeerId === assignment.providerId) };
  }
  return { requester, providers, intent, model, planned, adverts, execute };
}

afterEach(() => vi.useRealTimers());
describe('portable complete forecasting protocol', () => {
  it('preserves assignment validity after the discovery advert refresh lease and verifies archived acceptance after intent expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); const start = Date.now();
    const f = await fixture({ advertMs: 1000 });
    vi.setSystemTime(start + 2000);
    const executions = await Promise.all(f.planned.assignments.map(assignment => f.execute(assignment)));
    const accepted = await acceptForecastAgreement({ identity: f.requester, intent: f.intent, executions, expectedModel: f.model });
    vi.setSystemTime(start + 90000);
    expect((await verifyForecastEpisode({ intent: f.intent, executions, expectedModel: f.model, ...accepted })).acceptanceHash).toBe(accepted.acceptanceHash);
    await expect(acceptForecastAgreement({ identity: f.requester, intent: f.intent, executions, expectedModel: f.model })).rejects.toThrow(/expired/);
  });
  it('keeps the original assignment identity and does not self-admit a new public model', async () => {
    const input = { intentHash: hash('1'), providerId: 'provider', assignmentAttemptId: 'attempt', routeDecisionHash: hash('2'),
      providerAdvertHash: hash('3'), providerParticipationProfileHash: null, providerLimits: { maxConcurrentJobs: 1 } };
    expect((await sealPeerAssignmentIdentity(input)).assignmentHash).toBe(await hashJson({ schema: 'reploid.peer.assignment/v1', ...input }));
    const { model } = await fixture(); expect(validateEnabledPoolModelContract(model).ok).toBe(false);
  });

  it('binds signed intent, consent, routing, complete assignments, receipts and requester acceptance', async () => {
    const f = await fixture(); expect(f.planned.ok).toBe(true);
    const executions = await Promise.all(f.planned.assignments.map(assignment => f.execute(assignment)));
    for (const entry of executions) {
      expect(await validateForecastAssignment({ ...entry, intent: f.intent, expectedModel: f.model })).toBe(true);
      expect((await verifyForecastReceipt({ ...entry, expectedModel: f.model })).output.point).toEqual([11]);
    }
    const accepted = await acceptForecastAgreement({ identity: f.requester, intent: f.intent, executions, expectedModel: f.model });
    expect(accepted.acceptance.accepted).toBe(true); expect(accepted.acceptance.receiptHashes).toHaveLength(2);
    expect(accepted.agreement.maxAbsoluteError).toBe(0);
    expect((await verifyForecastEpisode({ intent: f.intent, executions, expectedModel: f.model, ...accepted })).acceptanceHash).toBe(accepted.acceptanceHash);
    const reordered = await assignForecastJob({ intent: f.intent, adverts: [...f.adverts].reverse(), expectedModel: f.model, assignmentAttemptId: 'attempt-1' });
    expect(reordered.route.decisionHash).toBe(f.planned.route.decisionHash);
    expect(reordered.assignments.map(a => a.assignmentHash)).toEqual(f.planned.assignments.map(a => a.assignmentHash));
  });

  it('rejects modified results, wrong assignments, duplicate keys and last-quantile disagreement', async () => {
    const f = await fixture();
    const entries = await Promise.all(f.planned.assignments.map(assignment => f.execute(assignment)));
    const modified = JSON.parse(canonicalize(entries[0])); modified.receipt.forecast.output.quantiles[0][2] = 500;
    await expect(verifyForecastReceipt({ ...modified, expectedModel: f.model })).rejects.toThrow();
    await expect(validateForecastAssignment({ ...entries[0], assignment: { ...entries[0].assignment, inputHash: hash('9') },
      intent: f.intent, expectedModel: f.model })).rejects.toThrow();
    await expect(acceptForecastAgreement({ identity: f.requester, intent: f.intent, executions: [entries[0], entries[0]], expectedModel: f.model })).rejects.toThrow();
    entries[1] = await f.execute(f.planned.assignments[1], 120);
    await expect(acceptForecastAgreement({ identity: f.requester, intent: f.intent, executions: entries, expectedModel: f.model })).rejects.toThrow(/disagree/);
  });

  it('counts absent latency as unknown and ignores self-reported reputation in this path', async () => {
    const f = await fixture();
    const candidates = f.planned.route.candidates;
    expect(candidates.every(c => c.score.evidencePenalty === 1)).toBe(true);
    expect(candidates.every(c => c.score.expectedLatencyMs === Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});
