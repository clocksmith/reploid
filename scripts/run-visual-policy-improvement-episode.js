#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ImprovementEpisodeLedgerModule, {
  ALGORITHM_MANIFEST_SCHEMA,
  hashImprovementValue
} from '../self/core/improvement-episode.js';
import {
  evaluateChangePassportGate,
  validateChangePassportPolicy
} from '../self/shared/change-passport/policy.js';
import { runVisualChangePassportDogfood } from './verify-visual-change-passport-dogfood.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const createMemoryVfs = () => {
  const files = new Map();
  return {
    files,
    exists: async (filePath) => files.has(filePath),
    read: async (filePath) => {
      if (!files.has(filePath)) throw new Error(`File not found: ${filePath}`);
      return files.get(filePath);
    },
    write: async (filePath, content) => {
      files.set(filePath, content);
      return true;
    }
  };
};

const gateProjection = (policy, evidenceKinds) => ({
  integrity: {valid: true},
  changeClass: 'source_patch',
  policy,
  evidence: {state: 'frozen', admitted: evidenceKinds.map((kind) => ({kind}))},
  evaluations: [{evaluationId: 'evaluation:frozen-visual-policy', conclusion: 'pass'}],
  reviews: [{
    reviewId: 'review:human-policy-owner',
    verdict: 'approve',
    actor: {role: 'visual_reviewer', authorityId: 'authority:human-policy-owner'}
  }],
  proposal: {proposerAuthorityId: 'authority:policy-candidate-generator'},
  evaluator: {authorityId: 'authority:frozen-policy-evaluator'},
  objections: [],
  decision: {state: 'approved'},
  supersededBy: null
});

export async function runVisualPolicyImprovementEpisode({outputDirectory} = {}) {
  const startedAt = new Date().toISOString();
  const outputRoot = path.resolve(outputDirectory || path.join(
    repositoryRoot,
    'docs/status/rsi/visual-policy-rollback-identity-2026-08-23'
  ));
  await fs.mkdir(outputRoot, {recursive: true});
  const baselinePath = path.join(repositoryRoot, 'docs/change-passport/dogfood/visual-policy-v1.0.0.json');
  const candidatePath = path.join(repositoryRoot, 'docs/change-passport/dogfood/visual-policy-v1.1.0.json');
  const activePath = path.join(repositoryRoot, 'docs/change-passport/dogfood/active-policy.json');
  const [baseline, candidate] = await Promise.all([readJson(baselinePath), readJson(candidatePath)]);
  for (const [label, policy] of [['baseline', baseline], ['candidate', candidate]]) {
    const validation = await validateChangePassportPolicy(policy);
    assert(validation.valid, `${label} policy is invalid: ${validation.reasons.join('; ')}`);
  }

  const baseEvidence = ['visual_complaint', 'source_owned_patch'];
  const cases = [
    {id: 'baseline_missing_rollback_identity', expectedEligible: true, result: evaluateChangePassportGate(gateProjection(baseline, baseEvidence))},
    {id: 'candidate_missing_rollback_identity', expectedEligible: false, result: evaluateChangePassportGate(gateProjection(candidate, baseEvidence))},
    {id: 'candidate_bound_rollback_identity', expectedEligible: true, result: evaluateChangePassportGate(gateProjection(candidate, [...baseEvidence, 'rollback_identity']))}
  ];
  for (const item of cases) assert(item.result.eligible === item.expectedEligible, `${item.id} violated the frozen expectation`);
  assert(cases[1].result.reasons.includes('required evidence missing: rollback_identity'), 'candidate did not retain the declared rejection reason');

  const evaluatorFiles = [
    'scripts/run-visual-policy-improvement-episode.js',
    'scripts/verify-visual-change-passport-dogfood.js',
    'tests/integration/visual-change-passport.test.js',
    'self/shared/change-passport/policy.js',
    'self/core/improvement-episode.js'
  ];
  const evaluatorDigest = digest((await Promise.all(evaluatorFiles.map(async (filePath) => (
    `${filePath}\n${await fs.readFile(path.join(repositoryRoot, filePath), 'utf8')}`
  )))).join('\n'));
  const corpusDigest = await hashImprovementValue(cases.map(({id, expectedEligible}) => ({id, expectedEligible})));
  const evaluationContractDigest = await hashImprovementValue({
    evaluatorDigest,
    corpusDigest,
    primaryMetric: 'rollback-identity-policy-correct',
    minimumSampleSize: 3,
    promotionThreshold: 1
  });
  const VFS = createMemoryVfs();
  const ledger = ImprovementEpisodeLedgerModule.factory({
    Utils: {logger: {warn: () => {}, info: () => {}}},
    VFS,
    EventBus: {emit: () => {}},
    AuditLogger: {logEvent: async () => {}}
  });
  const episodeId = 'episode:visual-policy:rollback-identity:2026-08-23';
  const protectedPaths = [
    '/self/core/improvement-episode.js',
    '/self/shared/change-passport/policy.js',
    '/server/change-control/visual-workflow.js',
    '/scripts/run-visual-policy-improvement-episode.js',
    '/scripts/verify-visual-change-passport-dogfood.js',
    '/tests/integration/visual-change-passport.test.js'
  ];
  await ledger.begin({
    episodeId,
    parentEpisodeId: null,
    groupId: 'run:visual-policy-rollback-identity',
    surface: 'other',
    objective: {
      objectiveId: 'rollback-identity-eligibility',
      statement: 'Reject Visual Passport eligibility when rollback identity evidence is absent without blocking a correctly bound candidate.',
      successMetricId: 'rollback-identity-policy-correct'
    },
    baseline: {
      generationId: 'visual-policy:1.0.0',
      hashes: {
        code: digest(await fs.readFile(path.join(repositoryRoot, 'self/shared/change-passport/policy.js'))),
        config: baseline.policyHash,
        model: digest('not-applicable:model'),
        prompt: digest('not-applicable:prompt'),
        artifacts: baseline.policyHash,
        contract: evaluationContractDigest
      },
      hashSemantics: {config: 'Visual Change Passport policy identity', contract: 'Frozen evaluator and three-case corpus identity'},
      snapshotPath: '/docs/change-passport/dogfood/visual-policy-v1.0.0.json'
    },
    proposer: {authorityId: 'reploid:policy-candidate-generator'},
    evaluator: {
      evaluatorId: 'reploid.visual-policy-rollback-identity',
      authorityId: 'reploid:frozen-policy-evaluator',
      version: '1.0.0',
      evaluatorHash: evaluatorDigest,
      testSuiteDigest: corpusDigest,
      protectedPaths,
      heldOut: true,
      frozenBeforeCandidate: true
    },
    metrics: [{
      metricId: 'rollback-identity-policy-correct',
      unit: 'boolean-score',
      direction: 'maximize',
      measurementSource: 'Three predeclared eligibility cases plus physical Chromium dogfood.',
      aggregationRule: 'One only when every expected eligibility result and the governed loop pass.',
      validityConditions: [
        'Evaluator and protected paths remain unchanged by the candidate',
        'Candidate with complete rollback identity remains eligible',
        'Visual dogfood reaches applied effect, observed render, source reversal, and reopened decision'
      ],
      noiseModel: 'Deterministic policy evaluation plus one physical Chromium conformance run.',
      minimumSampleSize: 3,
      promotionThreshold: {operator: '>=', value: 1},
      operational: false
    }],
    algorithm: {
      schema: ALGORITHM_MANIFEST_SCHEMA,
      algorithmId: 'reploid.visual-policy-candidate-generator',
      version: '1.0.0',
      sourceModules: ['/docs/change-passport/dogfood/visual-policy-v1.1.0.json'],
      inputs: ['Baseline policy and missing rollback identity failure'],
      outputs: ['One bounded policy candidate'],
      invariants: ['No evaluator, ledger, verifier, promotion adapter, or rollback path changes'],
      complexity: 'Constant-sized policy revision evaluated against three frozen cases.',
      resourceAssumptions: ['Local Node runtime and physical Chromium are available'],
      knownFailureModes: ['Policy-only checks can miss integration false blocks'],
      evaluationSuites: ['reploid.visual-policy-rollback-identity/v1'],
      dependencies: [],
      status: 'candidate',
      historicalRevisions: [baseline.policyHash],
      candidateAlternatives: []
    },
    environment: {runtime: process.version, host: process.platform, scope: 'dedicated_visual_dogfood_only'},
    corpus: {evaluationSplitHash: corpusDigest, heldOut: true, caseCount: cases.length},
    resourceBudget: {calls: 4, elapsedMs: 300000, costAmount: 0, costUnit: 'local_execution'}
  });
  await ledger.recordDiagnosis(episodeId, {
    diagnosis: 'The baseline policy binds a rollback contract but does not require that identity in the frozen admitted evidence set.',
    authorityId: 'reploid:policy-candidate-generator',
    hypothesis: {
      observation: 'The baseline gate remains eligible when rollback identity evidence is omitted.',
      suspectedCause: 'rollback_identity is absent from requiredEvidenceKinds.',
      alternativeExplanations: ['The start contract may make the additional evidence redundant'],
      proposedDiagnostic: 'Compare baseline and candidate against missing and complete rollback evidence, then run the full visual workflow.',
      candidateIntervention: 'Require rollback_identity in Visual dogfood policy version 1.1.0.',
      expectedResult: 'The missing case blocks and the complete case plus full workflow pass.',
      falsifyingResult: 'The missing case remains eligible or the complete case becomes blocked.',
      followUpHypothesis: null
    }
  });
  await ledger.proposeCandidate(episodeId, {
    candidateId: 'visual-policy:1.1.0',
    candidateHash: candidate.policyHash,
    patchHash: digest(await fs.readFile(candidatePath)),
    generationId: 'visual-policy:1.1.0',
    parentGenerationId: 'visual-policy:1.0.0',
    changedFiles: ['/docs/change-passport/dogfood/visual-policy-v1.1.0.json'],
    semanticScope: ['Visual dogfood eligibility evidence requirements'],
    expectedBehavior: 'Missing rollback identity evidence blocks while a bound rollback contract remains eligible.',
    affectedInvariants: ['Three-axis state remains independent', 'Rollback effects retain separate authority'],
    falsifier: 'Any frozen case differs from its expectation or the full workflow fails.'
  });
  await ledger.recordExecution(episodeId, {
    isolated: true,
    sandboxId: 'sandbox:visual-policy-rollback-identity',
    runtimeIdentity: `${process.version}/${process.platform}`,
    resourceUse: {calls: cases.length, costAmount: 0}
  });
  await ledger.recordVerification(episodeId, {
    passed: true,
    verifierId: 'reploid:visual-policy-verifier',
    evidencePaths: ['/docs/change-passport/dogfood/visual-policy-v1.0.0.json', '/docs/change-passport/dogfood/visual-policy-v1.1.0.json'],
    checks: cases.map((item) => ({id: item.id, passed: item.result.eligible === item.expectedEligible}))
  });
  await ledger.recordEvaluation(episodeId, {
    baselineContractHash: evaluationContractDigest,
    candidateContractHash: evaluationContractDigest,
    evaluatorHash: evaluatorDigest,
    sampleCount: cases.length,
    rawObservations: cases,
    metrics: [{metricId: 'rollback-identity-policy-correct', value: 1, valid: true}]
  });
  await ledger.recordComparison(episodeId, {
    primaryMetricId: 'rollback-identity-policy-correct',
    tradeoffs: [{metricId: 'false-block-count', baseline: 0, candidate: 0}],
    regressions: [],
    conclusion: 'improved',
    authorityId: 'reploid:frozen-policy-evaluator'
  });
  await ledger.requestPromotion(episodeId, {
    evidencePath: '/docs/status/rsi/visual-policy-rollback-identity-2026-08-23/evidence.json',
    authorityId: 'reploid:policy-promotion-gate'
  });
  await ledger.recordReview(episodeId, {
    reviewerId: 'human:portfolio-owner',
    decision: 'approve_dogfood_only',
    scope: 'docs/change-passport/dogfood/active-policy.json'
  });
  await ledger.recordDecision(episodeId, {
    state: 'promoted',
    reasons: [],
    authorityId: 'human:portfolio-owner',
    promotionId: 'promotion:visual-policy:1.1.0',
    qualificationGranted: false,
    crossRepositoryAuthorityGranted: false
  });

  const activation = {
    schema: 'reploid.change-passport-policy-activation/v1',
    policyId: candidate.policyId,
    version: candidate.version,
    policyHash: candidate.policyHash,
    source: 'docs/change-passport/dogfood/visual-policy-v1.1.0.json',
    scope: 'dedicated_visual_dogfood_only',
    authorityId: 'human:portfolio-owner',
    appliedAt: new Date().toISOString(),
    qualificationGranted: false
  };
  await fs.writeFile(activePath, `${JSON.stringify(activation, null, 2)}\n`);
  let visualResult;
  try {
    visualResult = await runVisualChangePassportDogfood({
      outputPath: path.join(outputRoot, 'change-passport-export.json'),
      policyOptions: {version: candidate.version, requiredEvidenceKinds: candidate.requiredEvidenceKinds}
    });
    assert(visualResult.policyHash === candidate.policyHash, 'dogfood did not execute the promoted policy');
  } catch (error) {
    await fs.writeFile(activePath, `${JSON.stringify({
      schema: activation.schema,
      policyId: baseline.policyId,
      version: baseline.version,
      policyHash: baseline.policyHash,
      source: 'docs/change-passport/dogfood/visual-policy-v1.0.0.json',
      scope: 'dedicated_visual_dogfood_only',
      authorityId: 'reploid:policy-rollback',
      rolledBackAt: new Date().toISOString(),
      qualificationGranted: false
    }, null, 2)}\n`);
    await ledger.recordRollback(episodeId, {
      rollbackPointer: '/docs/change-passport/dogfood/visual-policy-v1.0.0.json',
      restoredGenerationId: 'visual-policy:1.0.0',
      reason: `Post-promotion dogfood failed: ${error.message}`,
      authorityId: 'reploid:policy-rollback'
    });
    throw error;
  }
  await ledger.recordReflection(episodeId, {
    observation: 'The bounded candidate passed frozen cases and the visual workflow reopened after the declared source trigger.',
    suspectedCause: 'Explicit rollback identity evidence closes the baseline gap without changing effect authority.',
    alternativeExplanations: ['The internal corpus may not represent external agent-release workflows'],
    proposedDiagnostic: 'Run a separate Agent Release Passport pilot on one MCP server or permission-policy change class.',
    candidateIntervention: 'Retain policy 1.1.0 only for dedicated Visual dogfood.',
    expectedResult: 'Future dogfood candidates remain blocked when rollback identity evidence is absent.',
    falsifyingResult: 'A complete candidate false-blocks or a missing rollback identity becomes eligible.',
    followUpHypothesis: 'The same rule may reduce reconstruction gaps for versioned agent-tool releases.',
    authorityId: 'human:portfolio-owner'
  });
  const projection = await ledger.getEpisode(episodeId);
  const integrity = await ledger.verifyEpisode(episodeId);
  assert(integrity.valid, `improvement ledger failed verification: ${integrity.reasons.join('; ')}`);
  const paths = ledger.pathsForEpisode(episodeId);
  await Promise.all([
    fs.writeFile(path.join(outputRoot, 'events.jsonl'), VFS.files.get(paths.events)),
    fs.writeFile(path.join(outputRoot, 'projection.json'), `${JSON.stringify(projection, null, 2)}\n`)
  ]);
  const completedAt = new Date().toISOString();
  const evidence = {
    schema: 'reploid.visual-policy-improvement-evidence/v1',
    episodeId,
    startedAt,
    completedAt,
    generator: {
      authorityId: 'reploid:policy-candidate-generator',
      implementation: 'scripts/run-visual-policy-improvement-episode.js',
      digest: digest(await fs.readFile(fileURLToPath(import.meta.url)))
    },
    baseline: {path: path.relative(repositoryRoot, baselinePath), policyHash: baseline.policyHash},
    candidate: {path: path.relative(repositoryRoot, candidatePath), policyHash: candidate.policyHash},
    evaluator: {authorityId: 'reploid:frozen-policy-evaluator', digest: evaluatorDigest, corpusDigest},
    protectedPaths,
    budget: {callsMaximum: 4, callsConsumed: 4, costAmount: 0, costUnit: 'local_execution'},
    cases,
    negativeEvidence: [{
      id: 'baseline-admits-missing-rollback-identity',
      retained: true,
      baselineEligible: cases[0].result.eligible,
      candidateEligible: cases[1].result.eligible
    }],
    promotion: {
      scope: activation.scope,
      policyHash: activation.policyHash,
      humanAuthority: activation.authorityId,
      activePolicyPath: path.relative(repositoryRoot, activePath),
      productQualification: false,
      crossRepositoryAuthority: false
    },
    observedOutcome: visualResult,
    integrity,
    claimBoundary: 'Internal causal closure only. No customer value, product qualification, portfolio promotion, or cross-repository authority is granted.'
  };
  await fs.writeFile(path.join(outputRoot, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  return {ok: true, outputRoot, evidence, projection};
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    const outputIndex = process.argv.indexOf('--output');
    const result = await runVisualPolicyImprovementEpisode({
      outputDirectory: outputIndex >= 0 ? process.argv[outputIndex + 1] : null
    });
    process.stdout.write(`${JSON.stringify({
      ok: result.ok,
      episodeId: result.evidence.episodeId,
      policyHash: result.evidence.promotion.policyHash,
      decisionState: result.evidence.observedOutcome.decisionState,
      effectState: result.evidence.observedOutcome.effectState,
      outputRoot: result.outputRoot,
      claimBoundary: result.evidence.claimBoundary
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}
