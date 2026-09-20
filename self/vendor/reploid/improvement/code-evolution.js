import { hashImprovementValue as hash } from './episodes.js';

const copy = value => JSON.parse(JSON.stringify(value));
const assert = (ok, message) => { if (!ok) throw new Error(message); };

/** Governed replacement of explicitly registered pure tools. No evaluator or activation port is exposed to candidates. */
export function createCodeEvolution({ targets, policy, ports }) {
  policy = Object.freeze(copy(policy));
  const registry = copy(targets), frozenAt = new Date().toISOString();
  const { ledger } = ports;
  const targetFor = id => { const target = registry.find(item => item.id === id); assert(target, 'Unknown improvement target'); return target; };
  const load = async () => (await ports.load()) || { revision: 0, active: {}, candidates: [] };
  const commit = async state => { await ports.save(copy({ ...state, revision: state.revision + 1 })); state.revision++; ports.onChange?.(); };
  const version = (state, target) => state.active[target.id] || { code: target.code, generationId: target.id + ':genesis', episodeId: null };
  const publicCandidate = candidate => {
    const { baseline, ...view } = candidate;
    return { ...view, baselineGeneration: baseline.generationId };
  };
  const verifyActive = async (active, target) => {
    if (!active.episodeId) {
      assert(active.generationId === target.id + ':genesis' && active.code === target.code, 'Active tool does not match its immutable baseline');
      return;
    }
    const episode = await ledger.getEpisode(active.episodeId);
    assert(episode?.integrity?.valid && episode.candidate?.candidateHash === await hash(active.code)
      && episode.candidate.generationId === active.generationId && episode.objective.objectiveId === target.id
      && episode.decision?.state === 'promoted', 'Active tool does not match its signed approval');
  };
  const runCase = async (code, test, signal) => {
    try {
      const actual = await ports.execute(code, copy(test.input), { signal });
      return { passed: !test.throws && JSON.stringify(actual) === JSON.stringify(test.expected), actual };
    } catch (error) {
      signal?.throwIfAborted();
      return { passed: test.throws === true && error.candidateException === true, error: String(error.message || error) };
    }
  };
  const readOffer = async text => {
    assert(policy.offers && typeof text === 'string' && new TextEncoder().encode(text).byteLength <= policy.offers.maxBytes,
      'Candidate file exceeds its allowance or exchange is disabled');
    const offer = JSON.parse(text);
    assert(offer && typeof offer === 'object' && !Array.isArray(offer)
      && Object.keys(offer).sort().join(',') === 'code,codeHash,reason,schema,targetId'
      && offer.schema === 'reploid.tool-offer/v1', 'Unsupported candidate file');
    targetFor(offer.targetId);
    assert(typeof offer.code === 'string' && offer.code.length > 0 && offer.code.length <= policy.maxCodeCharacters, 'Candidate code exceeds its allowance');
    assert(typeof offer.reason === 'string' && offer.reason.trim() && offer.reason.length <= policy.offers.maxReasonCharacters, 'Candidate description exceeds its allowance');
    assert(offer.codeHash === await hash(offer.code), 'Candidate file code hash does not match');
    return offer;
  };
  const api = {
    offerLimits: policy.offers ? Object.freeze(copy(policy.offers)) : null,
    async describeContract(id) {
      const target = targetFor(id);
      return hash({ id: target.id, description: target.description, contract: target.contract || null });
    },
    async describe() {
      const state = await load();
      for (const [id, active] of Object.entries(state.active)) await verifyActive(active, targetFor(id));
      return registry.map(target => ({ id: target.id, description: target.description, ...version(state, target) }));
    },
    async list() {
      return ports.lock(async () => {
        const state = await load();
        for (const record of state.candidates.filter(item => item.status === 'evaluating')) {
          record.status = 'cancelled'; record.error = 'Evaluation was interrupted. The active tool was not changed.';
          try { await ledger.recordDecision(record.id, { state: 'inconclusive', reasons: [record.error] }); }
          catch (error) { record.error += ' Ledger recovery: ' + error.message; }
          await commit(state);
        }
        return state.candidates.map(publicCandidate);
      });
    },
    async run(id, input, { signal, versions } = {}) {
      const target = targetFor(id);
      const selected = versions?.find(item => item.id === id) || version(await load(), target);
      await verifyActive(selected, target);
      return ports.execute(selected.code, copy(input), { signal });
    },
    async propose({ targetId, code, reason, baselineGeneration, taskId, generator }, { signal, importedOfferHash, provenance } = {}) {
      assert(typeof code === 'string' && code.length > 0 && code.length <= policy.maxCodeCharacters, 'Candidate code exceeds its allowance');
      assert(typeof reason === 'string' && reason.trim(), 'Explain the proposed improvement');
      return ports.lock(async () => {
        signal?.throwIfAborted();
        if (importedOfferHash) assert(await ports.authorize({ action: 'improvement.import', targetId, sourceHash: importedOfferHash }) === true, 'Host denied candidate import');
        const state = await load(), target = targetFor(targetId), baseline = version(state, target);
        await verifyActive(baseline, target);
        assert(baseline.generationId === baselineGeneration, 'Tool version changed; inspect the current tool before proposing');
        assert(state.candidates.length < policy.maxCandidates, 'Improvement history is full; existing evidence was preserved');
        const id = 'candidate:' + crypto.randomUUID(), generationId = targetId + ':' + crypto.randomUUID();
        const record = { id, targetId, taskId, code, reason, baseline: copy(baseline), generationId,
          status: 'evaluating', createdAt: new Date().toISOString(), error: null };
        if (importedOfferHash) record.origin = { kind: provenance ? 'peer-transfer' : 'candidate-file', sourceHash: importedOfferHash,
          ...(provenance ? { transport: copy(provenance) } : {}) };
        const proposerAuthority = importedOfferHash ? 'work:operator-import' : 'work:agent';
        state.candidates.push(record); await commit(state);
        const candidateHash = await hash(code), baselineHash = await hash(baseline.code);
        const suiteHash = await hash(target.tests), budgetHash = await hash(policy);
        const generatorHash = await hash(generator), contractHash = await hash({ target: target.id, description: target.description, suiteHash, budgetHash });
        const evaluatorHash = await hash({ implementation: runCase.toString(), version: 1, suiteHash });
        const path = '/shadow/work-tools/' + id + '.js';
        const evidencePath = '/artifacts/work-improvements/' + id + '.json';
        try {
          await ledger.begin({ episodeId: id, parentEpisodeId: baseline.episodeId, groupId: taskId, surface: 'other',
            objective: { objectiveId: targetId, statement: target.description, successMetricId: 'additional-cases' },
            baseline: { generationId: baseline.generationId, hashes: { code: baselineHash, config: budgetHash,
              model: await hash(generator.model), prompt: await hash(generator.instruction), artifacts: baselineHash, contract: contractHash } },
            proposer: { authorityId: proposerAuthority },
            generator: { authorityId: proposerAuthority, implementation: generator.implementation, implementationHash: generatorHash, frozenBeforeCandidate: true },
            evaluator: { evaluatorId: 'work:protected-suite', authorityId: 'work:evaluator', version: '1', evaluatorHash,
              testSuiteDigest: suiteHash, protectedPaths: ['/config/work-evolution.json', '/host/work-evolution.js', '/infrastructure/code-sandbox.js'],
              heldOut: true, frozenBeforeCandidate: true, frozenAt },
            metrics: [{ metricId: 'additional-cases', unit: 'cases', direction: 'maximize', measurementSource: evidencePath,
              aggregationRule: 'Candidate passes minus baseline passes; no baseline regressions.',
              validityConditions: ['All candidate cases pass', 'No previously passing case fails'], noiseModel: 'Deterministic finite contract suite; no generalization claim',
              minimumSampleSize: target.tests.length, promotionThreshold: { operator: '>=', value: 1 }, operational: false }],
            algorithm: { algorithmId: targetId, version: baseline.generationId, sourceModules: [path], inputs: ['JSON task input'], outputs: ['JSON tool result'],
              invariants: ['No host access or side effects', 'Protected tests are never candidate-controlled'], complexity: 'Bounded by host timeout',
              resourceAssumptions: ['Browser sandbox available'], knownFailureModes: ['Timeout', 'Incorrect output'], evaluationSuites: [suiteHash], dependencies: [], status: 'candidate' },
            environment: { runtime: 'opaque-origin-frame-worker', qualification: 'local finite-suite evaluation' },
            corpus: { digest: suiteHash, heldOut: true, frozenBeforeCandidate: true },
            resourceBudget: { ...policy, digest: budgetHash, frozenBeforeCandidate: true },
            promotionAuthority: { repositoryId: 'clocksmith/reploid', authorityId: 'work:operator', scope: 'registered-pure-tools',
              allowedCandidatePaths: ['/shadow/work-tools'], allowedEffectKinds: ['tool_activation'], frozenBeforeCandidate: true },
            reopeningConditions: [{ conditionId: 'operator-rollback', observationKind: 'tool_failure', targetId,
              sensorAuthorityId: 'work:operator', action: 'rollback_request' }] });
          await ledger.recordDiagnosis(id, { authorityId: proposerAuthority, diagnosis: reason, hypothesis: {
            observation: reason, suspectedCause: 'The current tool does not cover the requested input',
            alternativeExplanations: ['The task may be outside this tool contract'], proposedDiagnostic: 'Compare both versions on the frozen host suite',
            candidateIntervention: 'Replace the registered pure tool implementation', expectedResult: 'More passing cases without regressions',
            falsifyingResult: 'No improvement or any regression' } });
          await ledger.proposeCandidate(id, { candidateId: id, candidateHash, patchHash: await hash({ before: baseline.code, after: code }),
            generationId, parentGenerationId: baseline.generationId, changedFiles: [path], semanticScope: [targetId], expectedBehavior: reason,
            affectedInvariants: ['Preserve valid inputs'], falsifier: 'A contract case fails', generatorAuthorityId: proposerAuthority, generatorHash });
          const verification = await ports.verify(code, signal);
          await ledger.recordVerification(id, { passed: verification.passed === true, verifierId: 'work:verification-worker', evidencePaths: [evidencePath], checks: verification });
          assert(verification.passed, 'Candidate failed static verification: ' + JSON.stringify(verification.errors));
          const observations = [];
          for (const [index, test] of target.tests.entries()) {
            signal?.throwIfAborted();
            const before = await runCase(baseline.code, test, signal), after = await runCase(code, test, signal);
            observations.push({ index, baseline: before, candidate: after, valid: true });
          }
          record.evaluation = { baselinePassed: observations.filter(item => item.baseline.passed).length,
            candidatePassed: observations.filter(item => item.candidate.passed).length, total: observations.length,
            regressions: observations.filter(item => item.baseline.passed && !item.candidate.passed).map(item => item.index),
            suiteHash, candidateHash, baselineHash, contractHash };
          const e = record.evaluation;
          const improved = e.candidatePassed === e.total && !e.regressions.length && e.candidatePassed > e.baselinePassed;
          await ports.writeEvidence(evidencePath, { observations, evaluation: e });
          await ledger.recordExecution(id, { isolated: true, sandboxId: 'opaque-worker:' + id, runtimeIdentity: 'browser:opaque-origin-worker', resourceUse: { samples: observations.length * 2 } });
          await ledger.recordNegativeEvidence(id, { evidenceId: 'baseline-cases', kind: 'baseline_comparison', digest: await hash(observations),
            summary: `${e.baselinePassed}/${e.total} baseline cases passed`, retained: true, sourcePath: evidencePath });
          await ledger.recordEvaluation(id, { baselineContractHash: contractHash, candidateContractHash: contractHash, evaluatorHash,
            sampleCount: observations.length, rawObservations: observations,
            metrics: [{ metricId: 'additional-cases', value: e.candidatePassed - e.baselinePassed, valid: improved }] });
          await ledger.recordComparison(id, { authorityId: 'work:evaluator', primaryMetricId: 'additional-cases',
            tradeoffs: [e], regressions: e.regressions, conclusion: improved ? 'improved' : 'not-improved' });
          if (improved) { await ledger.requestPromotion(id, { authorityId: 'work:operator', evidencePath }); record.status = 'awaiting-approval'; }
          else { await ledger.recordDecision(id, { state: 'rejected', reasons: ['The candidate did not improve every required contract boundary'] }); record.status = 'rejected'; }
        } catch (error) {
          record.status = signal?.aborted ? 'cancelled' : 'failed'; record.error = String(error.message || error);
          try { await ledger.recordDecision(id, { state: 'inconclusive', reasons: [record.error] }); } catch { /* Preserve the original failure in the host record. */ }
        }
        await commit(state);
        return publicCandidate(record);
      });
    },
    async decide(id, accepted) {
      assert(typeof accepted === 'boolean', 'An explicit decision is required');
      return ports.lock(async () => {
        const state = await load(), record = state.candidates.find(item => item.id === id);
        assert(record?.status === 'awaiting-approval', 'Candidate is not awaiting approval');
        const target = targetFor(record.targetId);
        assert(version(state, target).generationId === record.baseline.generationId, 'Baseline changed; evaluate a fresh candidate');
        assert(await ports.authorize({ action: 'improvement.adopt', candidateId: id, accepted }) === true, 'Host denied adoption');
        const episode = await ledger.getEpisode(id);
        assert(ledger.assessPromotionReadiness(episode).ready, 'Signed evaluation is not adoption-ready');
        assert(episode.objective.objectiveId === target.id && episode.candidate.generationId === record.generationId
          && episode.baseline.generationId === record.baseline.generationId
          && episode.baseline.hashes.code === await hash(version(state, target).code), 'Candidate target or baseline differs from evaluation');
        assert(await hash(record.code) === episode.candidate.candidateHash, 'Candidate bytes differ from evaluation');
        // A storage failure after a signed approval must be retryable without rewriting the decision.
        if (episode.decision?.state === 'promoted') {
          assert(accepted, 'This candidate already has signed approval; retry activation or leave the current tool active');
        } else {
          await ledger.recordReview(id, { reviewerId: 'work:operator', decision: accepted ? 'approve' : 'reject' });
          await ledger.recordDecision(id, { state: accepted ? 'promoted' : 'rejected', reasons: accepted ? [] : ['Declined by operator'] });
        }
        if (accepted) state.active[target.id] = { code: record.code, generationId: record.generationId, episodeId: id };
        record.status = accepted ? 'adopted' : 'rejected';
        await commit(state);
        if (accepted) await ledger.recordEffect(id, { effectId: 'activation:' + id, kind: 'tool_activation', state: 'applied',
          targetId: target.id, artifactHash: await hash(record.code), receiptPath: '/artifacts/work-improvements/' + id + '.json' });
        return publicCandidate(record);
      });
    },
    async export(id) {
      const record = (await load()).candidates.find(item => item.id === id);
      assert(record, 'Candidate not found');
      return { candidate: copy(record), episode: await ledger.getEpisode(id), events: await ledger.readEvents(id) };
    },
    async exportOffer(id) {
      assert(await ports.authorize({ action: 'improvement.export', candidateId: id }) === true, 'Host denied candidate export');
      const record = (await load()).candidates.find(item => item.id === id);
      assert(record, 'Candidate not found');
      const episode = await ledger.getEpisode(id);
      const codeHash = await hash(record.code);
      assert(episode?.integrity?.valid && episode.candidate?.candidateHash === codeHash, 'Candidate bytes differ from signed proposal');
      return readOffer(JSON.stringify({ schema: 'reploid.tool-offer/v1', targetId: record.targetId,
        code: record.code, reason: record.reason, codeHash }));
    },
    async inspectOffer(text) {
      const offer = await readOffer(text);
      const state = await load(), target = targetFor(offer.targetId), baseline = version(state, target);
      await verifyActive(baseline, target);
      return { ...offer, baselineGeneration: baseline.generationId, sourceHash: await hash(offer) };
    },
    async importOffer(text, { baselineGeneration, signal, provenance } = {}) {
      const offer = await readOffer(text), sourceHash = await hash(offer);
      signal?.throwIfAborted();
      return api.propose({ targetId: offer.targetId, code: offer.code, reason: offer.reason, baselineGeneration,
        taskId: 'import:' + sourceHash,
        generator: { implementation: 'reploid:operator-import', model: null,
          instruction: 'Operator-imported candidate ' + sourceHash + '; authorship and prior performance are unverified.'
            + (provenance ? ' Transport record: ' + await hash(provenance) : '') } },
      { signal, importedOfferHash: sourceHash, provenance });
    },
    async rollback(id) {
      return ports.lock(async () => {
        const state = await load(), record = state.candidates.find(item => item.id === id);
        assert(record?.status === 'adopted' && state.active[record.targetId]?.episodeId === id, 'Only the active version can be rolled back');
        assert(await ports.authorize({ action: 'improvement.rollback', candidateId: id }) === true, 'Host denied rollback');
        state.active[record.targetId] = copy(record.baseline); record.status = 'rolled-back';
        await commit(state);
        await ledger.recordRollback(id, { authorityId: 'work:operator', rollbackPointer: '/artifacts/work-improvements/' + id + '.json',
          restoredGenerationId: record.baseline.generationId, reason: 'Operator restored the previous tool version' });
        return publicCandidate(record);
      });
    }
  };
  return Object.freeze(api);
}
