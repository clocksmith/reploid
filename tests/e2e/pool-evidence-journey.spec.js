import { expect, test } from '@playwright/test';

test('shows and exercises the governed protein evidence journey', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Ask a protein question', exact: true })).toBeVisible();
  await expect(page.getByLabel('Public protein sequence')).toBeVisible();
  await expect(page.locator('[data-pool-research-room]')).toHaveCount(0);
  await expect(page.locator('.pool-simulation-shell')).toHaveCount(0);
  await expect(page.locator('#pool-home-research-public')).toBeAttached();
  await expect(page.locator('#pool-home-intent-text')).toBeAttached();

  await page.evaluate(async () => {
    const evidence = await import('/pool/evidence-network.js');
    const receipts = await import('/pool/inference-receipt.js');
    const modelContracts = await import('/pool/model-contract.js');
    const sequenceResults = await import('/pool/sequence-result.js');
    const store = await import('/ui/pool-home/research-store.js');
    const fakeHash = (character) => `sha256:${character.repeat(64)}`;
    const createIdentity = async (kind, id) => {
      const keyPair = await receipts.createSigningKeyPair();
      return {
        resolve: async () => ({
          kind,
          roleId: `${kind}_${id}`,
          userId: `user_${id}`,
          deviceId: `device_${id}`,
          identityRootId: `root_${id}`
        }),
        getSigningKeyPair: async () => keyPair
      };
    };
    const model = modelContracts.buildLaunchProviderModel();
    const embedding = (firstValue, secondValue = 0) => Array.from(
      { length: model.embeddingDimensions },
      (_, index) => (index === 0 ? firstValue : (index === 1 ? secondValue : 0))
    );
    const requester = await createIdentity('requester', 'e2e-requester');
    const researcher = await createIdentity('researcher', 'e2e-researcher');
    const curator = await createIdentity('reviewer', 'e2e-curator');
    const independent = await createIdentity('reviewer', 'e2e-independent');
    const laboratoryOne = await createIdentity('researcher', 'e2e-laboratory-one');
    const laboratoryTwo = await createIdentity('researcher', 'e2e-laboratory-two');
    const evaluator = await createIdentity('verifier', 'e2e-evaluator');
    const submissionBaseTime = Date.now() - 10_000;
    const createSubmission = (sequence, label, createdAt) => evidence.createSignedResearchSubmission({
      identity: requester,
      roomId: 'reploid-default',
      sequence,
      intent: { kind: 'hypothesis', text: `Review ${label} against public evidence.`, label },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement',
      createdAt
    });
    const firstSubmission = await createSubmission(
      'MAPLALLLLGLVAGA',
      'First public candidate',
      new Date(submissionBaseTime).toISOString()
    );
    const secondSubmission = await createSubmission(
      'MKVLVVLLCLVPAYG',
      'Second public candidate',
      new Date(submissionBaseTime + 1).toISOString()
    );
    const createResult = async (submission, vector, receiptCharacter) => {
      const vectorHash = await sequenceResults.hashSequenceFloat32Values(vector);
      const jobId = `job_${receiptCharacter}`;
      const providerIds = [`provider_${receiptCharacter}`, `provider_${receiptCharacter}_independent`];
      const receiptEvidence = [];
      for (const [index, providerId] of providerIds.entries()) {
        const keyPair = await receipts.createSigningKeyPair();
        const receipt = await receipts.signProviderReceipt({
          model,
          providerId,
          assignmentId: `${jobId}_assignment_${index + 1}`,
          jobId,
          inputHash: submission.sequence.hash,
          outputKind: 'sequence.embedding.v1',
          vectorHash
        }, keyPair.privateKey);
        receiptEvidence.push({
          receiptHash: await receipts.hashJson(receipt),
          providerId,
          providerPublicKey: await receipts.exportPublicKey(keyPair.publicKey),
          receipt
        });
      }
      const agreement = {
        status: 'accepted',
        jobId,
        agreementField: 'vectorHash',
        agreementValue: vectorHash,
        receiptHashes: receiptEvidence.map((entry) => entry.receiptHash),
        providerIds
      };
      return evidence.createSignedResearchResult({
        identity: requester,
        submission,
        receiptRecord: { ...receiptEvidence[0], verifierDecision: { accepted: true } },
        receiptEvidence,
        agreement,
        embedding: vector
      });
    };
    const firstResult = await createResult(firstSubmission, embedding(1), 'a');
    const secondResult = await createResult(secondSubmission, embedding(0.99, 0.01), 'b');
    const annotation = await evidence.createSignedHumanClaim({
      identity: curator,
      roomId: 'reploid-default',
      targetHash: secondResult.recordHash,
      claimKind: 'annotation',
      relation: 'supports',
      text: 'Reviewed hydrophobic N-terminus evidence.',
      confidence: 0.9,
      evidenceLinks: ['https://example.org/public-assay']
    });
    const review = await evidence.createSignedHumanClaim({
      identity: independent,
      roomId: 'reploid-default',
      targetHash: annotation.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'Attribution and public source are sufficient.',
      confidence: 0.95,
      decision: 'accepted'
    });
    const protocol = {
      protocolId: 'e2e.secretory-assay',
      version: '1.0.0',
      assayType: 'secretory-reporter',
      referenceIdentities: [{ accession: 'E2E-PROTOCOL', version: '1.0.0' }],
      conditions: { biologicalSystem: 'public cell-free reporter', temperature: '30 C' },
      controls: ['positive control', 'negative control'],
      readouts: ['normalized reporter ratio'],
      normalization: { method: 'control-ratio', version: '1.0.0' },
      uncertaintyPlan: 'Report raw values and standard error.',
      acceptanceCriteria: 'Controls pass and both laboratories report.'
    };
    const prior = await evidence.createSignedPriorEvidence({
      identity: curator,
      roomId: 'reploid-default',
      questionHash: firstSubmission.recordHash,
      evidenceKind: 'annotation',
      summary: 'Versioned public annotation with no direct functional assay.',
      reference: { uri: 'https://example.org/public-record', accession: 'E2E-001', version: '3' },
      conditions: { biologicalSystem: 'public annotation archive' },
      uncertainty: { method: 'curator confidence', value: 0.5, unit: 'probability' },
      provenance: { retrievalMethod: 'version-pinned HTTP retrieval', retrievedAt: new Date().toISOString() }
    });
    const hypothesisOne = await evidence.createSignedResearchHypothesis({
      identity: curator,
      roomId: 'reploid-default',
      questionHash: firstSubmission.recordHash,
      statement: 'The protein is secreted under the declared assay conditions.',
      conditions: protocol.conditions,
      discriminatingObservations: ['Reporter ratio exceeds 0.7.'],
      priorEvidenceHashes: [prior.recordHash]
    });
    const hypothesisTwo = await evidence.createSignedResearchHypothesis({
      identity: curator,
      roomId: 'reploid-default',
      questionHash: firstSubmission.recordHash,
      statement: 'The protein remains membrane-associated under the declared conditions.',
      conditions: protocol.conditions,
      discriminatingObservations: ['Reporter ratio remains below 0.3.'],
      priorEvidenceHashes: [prior.recordHash],
      alternativeToHashes: [hypothesisOne.recordHash]
    });
    const resolutionFrozenAt = new Date().toISOString();
    const resolutionPolicy = await evidence.createSignedResearchResolutionPolicy({
      identity: curator,
      roomId: 'reploid-default',
      questionHash: firstSubmission.recordHash,
      targetHypothesisHash: hypothesisOne.recordHash,
      conclusionLabel: 'Secreted under the frozen E2E public assay conditions',
      decisionScope: 'Only the public sequence and exact E2E reporter protocol.',
      provisionalAcceptance: {
        outcomeClassifications: ['positive'],
        minimumAcceptedCompletedOutcomes: 2,
        minimumIndependentReplications: 1,
        maximumAmbiguousOutcomes: 0,
        requiredDistinctReviewerIdentities: 1,
        uncertainty: { methodId: 'standard-error', version: '1.0.0', metricId: 'reporter-ratio-se', maximumValue: 0.1, unit: 'ratio' }
      },
      continuedUncertainty: {
        triggers: ['insufficient_accepted_outcomes', 'insufficient_independent_replications', 'ambiguous_outcome', 'failed_attempt', 'disputed_review', 'active_contradiction', 'uncertainty_above_threshold', 'control_failure']
      },
      rejection: {
        outcomeClassifications: ['negative'],
        minimumAcceptedCompletedOutcomes: 2,
        minimumIndependentReplications: 1,
        maximumAmbiguousOutcomes: 0,
        requiredDistinctReviewerIdentities: 1,
        uncertainty: { methodId: 'standard-error', version: '1.0.0', metricId: 'reporter-ratio-se', maximumValue: 0.1, unit: 'ratio' }
      },
      reopening: { triggers: ['contradiction', 'correction', 'revocation', 'failed_replication', 'policy_invalidation'] },
      closure: {
        minimumAcceptedCompletedOutcomes: 3,
        minimumIndependentReplications: 2,
        maximumAmbiguousOutcomes: 0,
        requiredDistinctReviewerIdentities: 2,
        requireAllControlsPassed: true,
        requireNoDisputedReviews: true,
        requireNoActiveContradictions: true
      },
      frozenAt: resolutionFrozenAt
    });
    const resolutionPolicyReview = await evidence.createSignedHumanClaim({
      identity: independent,
      roomId: 'reploid-default',
      targetHash: resolutionPolicy.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'The bounded criteria were frozen before work and retain reopening triggers.',
      confidence: 0.95,
      decision: 'accepted',
      createdAt: new Date(Date.parse(resolutionFrozenAt) + 1).toISOString()
    });
    const predictionOne = await evidence.createSignedResearchPrediction({
      identity: researcher,
      roomId: 'reploid-default',
      questionHash: firstSubmission.recordHash,
      hypothesisHash: hypothesisOne.recordHash,
      method: { methodId: 'e2e-predictor-a', version: '1.0.0', artifactHash: fakeHash('4') },
      expectedObservation: 'Reporter ratio is above 0.7.',
      normalizedLabel: 'secreted',
      conditions: protocol.conditions,
      confidence: 0.75
    });
    const predictionTwo = await evidence.createSignedResearchPrediction({
      identity: evaluator,
      roomId: 'reploid-default',
      questionHash: firstSubmission.recordHash,
      hypothesisHash: hypothesisTwo.recordHash,
      method: { methodId: 'e2e-predictor-b', version: '2.0.0', artifactHash: fakeHash('5') },
      expectedObservation: 'Reporter ratio is below 0.3.',
      normalizedLabel: 'membrane-associated',
      conditions: protocol.conditions,
      confidence: 0.7
    });
    const predictionReviewOne = await evidence.createSignedHumanClaim({
      identity: independent,
      roomId: 'reploid-default',
      targetHash: predictionOne.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'The first frozen prediction is attributable and cohort-eligible.',
      confidence: 0.9,
      decision: 'accepted'
    });
    const predictionReviewTwo = await evidence.createSignedHumanClaim({
      identity: independent,
      roomId: 'reploid-default',
      targetHash: predictionTwo.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'The second frozen prediction is attributable and cohort-eligible.',
      confidence: 0.9,
      decision: 'accepted'
    });
    const order = await evidence.createSignedResearchWorkOrder({
      identity: curator,
      roomId: 'reploid-default',
      questionHash: firstSubmission.recordHash,
      hypothesisHashes: [hypothesisOne.recordHash, hypothesisTwo.recordHash],
      title: 'E2E blinded secretory assay',
      protocol,
      replicaTarget: 2,
      blindness: { required: true, allocationHash: fakeHash('6') },
      feasibility: {
        resources: 'Public cell-free reporter kit.',
        biosafety: 'Public, non-pathogenic, non-clinical protocol only.',
        limitations: 'The reporter does not establish native biological function.'
      },
      analysis: { methodId: 'e2e-analysis', version: '1.0.0', artifactHash: fakeHash('7'), parametersHash: fakeHash('8') },
      failureCategories: ['expression_failure', 'protocol_failure', 'analysis_failure', 'inconclusive'],
      custody: {
        planId: 'e2e-public-custody',
        version: '1.0.0',
        artifactHash: fakeHash('5'),
        requiredRoles: ['operator'],
        materialsPolicy: 'Record public material lots.',
        samplesPolicy: 'Public synthetic samples under blinded codes.',
        instrumentsPolicy: 'Record instrument identity and calibration.'
      },
      publication: {
        scope: 'public_complete_record',
        license: 'CC-BY-4.0',
        publishLaboratoryIdentity: true,
        publishQualification: true,
        publishProtocol: true,
        publishRawObservations: true,
        publishFailures: true
      },
      replication: {
        requiredIndependentDimensions: [
          'operator_identity',
          'institution',
          'instrument',
          'sample_batch',
          'preparation_batch',
          'analysis_execution'
        ]
      },
      scopeBoundary: {
        biologicalInterpretation: 'evidence_only_no_interpretation_authority',
        medicalUse: 'prohibited',
        protocolSafetyClassification: 'public_non_pathogenic_non_clinical',
        sampleScope: 'explicitly_public_synthetic_or_public_reference_only',
        privateSamples: 'prohibited',
        laboratoryAuthority: 'none',
        safetyReview: 'independent_human_required_before_execution'
      },
      createdAt: new Date(Date.parse(resolutionFrozenAt) + 2).toISOString()
    });
    const orderReview = await evidence.createSignedHumanClaim({
      identity: independent,
      roomId: 'reploid-default',
      targetHash: order.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'The assay distinguishes both hypotheses with explicit controls.',
      confidence: 0.95,
      decision: 'accepted'
    });
    const claimOne = await evidence.createSignedResearchWorkClaim({
      identity: laboratoryOne,
      roomId: 'reploid-default',
      workOrderHash: order.recordHash,
      laboratory: {
        id: 'e2e-lab-one',
        name: 'E2E Laboratory One',
        institution: 'E2E Public Institute One',
        institutionIdentityHash: fakeHash('a')
      },
      capabilityClaims: [{
        id: 'secretory-reporter-assay',
        version: '1.0.0',
        evidenceHash: fakeHash('b'),
        description: 'Operate the declared blinded secretory reporter assay.'
      }],
      protocolCustody: { protocolHash: order.work.protocol.protocolHash, role: 'operator', evidenceHash: fakeHash('c') },
      safety: {
        classification: 'public_non_pathogenic_non_clinical',
        oversightAuthority: 'Declared institutional biosafety oversight',
        approvalHash: fakeHash('d'),
        limitations: ['No clinical, pathogenic, or private-sequence work.']
      },
      availability: {
        status: 'available',
        capacity: 'One blinded paired run.',
        validFrom: '2026-08-01T00:00:00.000Z',
        validUntil: '2027-08-01T00:00:00.000Z'
      },
      consent: { publicLaboratoryIdentity: true, publishQualification: true, publishOutcome: true },
      conflictDisclosure: 'none declared'
    });
    const claimTwo = await evidence.createSignedResearchWorkClaim({
      identity: laboratoryTwo,
      roomId: 'reploid-default',
      workOrderHash: order.recordHash,
      laboratory: {
        id: 'e2e-lab-two',
        name: 'E2E Laboratory Two',
        institution: 'E2E Public Institute Two',
        institutionIdentityHash: fakeHash('e')
      },
      capabilityClaims: [{
        id: 'secretory-reporter-replication',
        version: '1.0.0',
        evidenceHash: fakeHash('f'),
        description: 'Independently replicate the declared secretory reporter assay.'
      }],
      protocolCustody: { protocolHash: order.work.protocol.protocolHash, role: 'operator', evidenceHash: fakeHash('0') },
      safety: {
        classification: 'public_non_pathogenic_non_clinical',
        oversightAuthority: 'Declared institutional biosafety oversight',
        approvalHash: fakeHash('4'),
        limitations: ['No clinical, pathogenic, or private-sequence work.']
      },
      availability: {
        status: 'available',
        capacity: 'One independent blinded run.',
        validFrom: '2026-08-01T00:00:00.000Z',
        validUntil: '2027-08-01T00:00:00.000Z'
      },
      consent: { publicLaboratoryIdentity: true, publishQualification: true, publishOutcome: true },
      conflictDisclosure: 'none declared'
    });
    const cohort = await evidence.createSignedEvaluationCohort({
      identity: evaluator,
      roomId: 'reploid-default',
      label: 'E2E frozen prospective cohort',
      questionHashes: [firstSubmission.recordHash],
      predictionHashes: [predictionOne.recordHash, predictionTwo.recordHash],
      workOrderHashes: [order.recordHash],
      metrics: [{ id: 'balanced_accuracy', label: 'Balanced accuracy', direction: 'higher_is_better', unit: 'fraction' }]
    });
    const cohortReview = await evidence.createSignedHumanClaim({
      identity: independent,
      roomId: 'reploid-default',
      targetHash: cohort.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'The frozen cohort contains only independently accepted predictions and work orders.',
      confidence: 0.95,
      decision: 'accepted'
    });
    const outcomeOne = await evidence.createSignedExperimentalOutcome({
      identity: laboratoryOne,
      roomId: 'reploid-default',
      questionHash: firstSubmission.recordHash,
      workOrderHash: order.recordHash,
      workClaimHash: claimOne.recordHash,
      hypothesisHashes: order.hypothesisHashes,
      classification: 'positive',
      summary: 'The first blinded laboratory outcome crossed the threshold.',
      attempt: { status: 'completed', failureCategory: 'none' },
      observations: [{ readout: 'reporter ratio', value: 0.82, normalizedValue: 0.82, unit: 'ratio', uncertainty: { method: 'standard error', value: 0.04, unit: 'ratio' } }],
      protocol,
      analysis: { methodId: 'e2e-analysis', version: '1.0.0', artifactHash: fakeHash('7'), parametersHash: fakeHash('8') },
      executionContext: {
        institutionIdentityHash: fakeHash('a'),
        instrumentIdentityHash: fakeHash('1'),
        sampleBatchHash: fakeHash('2'),
        preparationBatchHash: fakeHash('3'),
        analysisExecutionHash: fakeHash('4')
      },
      uncertainty: { method: 'standard error', value: 0.04, unit: 'ratio' },
      blind: { state: 'sealed', codeHash: fakeHash('8'), allocationHash: fakeHash('6') }
    });
    const outcomeTwo = await evidence.createSignedExperimentalOutcome({
      identity: laboratoryTwo,
      roomId: 'reploid-default',
      questionHash: firstSubmission.recordHash,
      workOrderHash: order.recordHash,
      workClaimHash: claimTwo.recordHash,
      hypothesisHashes: order.hypothesisHashes,
      classification: 'ambiguous',
      summary: 'The independent replica retained a high-variance failure.',
      attempt: { status: 'failed', failureCategory: 'inconclusive', failureDetail: 'Control variance exceeded the criterion.' },
      observations: [{ readout: 'reporter ratio', value: 0.72, normalizedValue: 0.72, unit: 'ratio', uncertainty: { method: 'standard error', value: 0.2, unit: 'ratio' } }],
      protocol,
      analysis: { methodId: 'e2e-analysis', version: '1.0.0', artifactHash: fakeHash('7'), parametersHash: fakeHash('8'), lineageHashes: [outcomeOne.recordHash] },
      executionContext: {
        institutionIdentityHash: fakeHash('e'),
        instrumentIdentityHash: fakeHash('5'),
        sampleBatchHash: fakeHash('6'),
        preparationBatchHash: fakeHash('7'),
        analysisExecutionHash: fakeHash('8')
      },
      uncertainty: { method: 'standard error', value: 0.2, unit: 'ratio' },
      blind: { state: 'sealed', codeHash: fakeHash('9'), allocationHash: fakeHash('6') },
      replicationOfHash: outcomeOne.recordHash
    });
    const outcomeReviewOne = await evidence.createSignedHumanClaim({ identity: independent, roomId: 'reploid-default', targetHash: outcomeOne.recordHash, claimKind: 'review_decision', relation: 'reviews', text: 'Complete positive outcome.', confidence: 0.9, decision: 'accepted' });
    const outcomeReviewTwo = await evidence.createSignedHumanClaim({ identity: independent, roomId: 'reploid-default', targetHash: outcomeTwo.recordHash, claimKind: 'review_decision', relation: 'reviews', text: 'Complete ambiguous failure outcome.', confidence: 0.9, decision: 'accepted' });
    const evaluation = await evidence.createSignedCohortEvaluation({
      identity: evaluator,
      roomId: 'reploid-default',
      cohortHash: cohort.recordHash,
      outcomeHashes: [outcomeOne.recordHash, outcomeTwo.recordHash],
      metricResults: [{ metricId: 'balanced_accuracy', direction: 'higher_is_better', baselineValue: 0.5, currentValue: 0.7 }],
      disagreementSummary: 'Two exact predictors disagreed and both outputs stayed frozen.',
      failureAnalysis: 'The ambiguous replica remains in the cohort and explains control variance.',
      nextCohortQuestionHashes: [firstSubmission.recordHash]
    });
    const candidateAction = await evidence.createSignedCandidateAction({
      identity: researcher,
      roomId: 'reploid-default',
      questionHash: firstSubmission.recordHash,
      action: {
        kind: 'retrieval',
        title: 'Retrieve an independent pinned family annotation',
        rationale: 'A second versioned public source could resolve the current annotation disagreement.',
        affectedHypothesisHashes: [hypothesisOne.recordHash, hypothesisTwo.recordHash],
        predictedObservations: [{
          observation: 'The independent source assigns one of the declared families under its pinned release.',
          affectedHypothesisHashes: [hypothesisOne.recordHash, hypothesisTwo.recordHash]
        }],
        falsifiers: [{ hypothesisHash: hypothesisOne.recordHash, observation: 'The source assigns an incompatible family.' }, { hypothesisHash: hypothesisTwo.recordHash, observation: 'The source reports no compatible membrane-associated family.' }],
        execution: { contractKind: 'workload', contractId: 'e2e.catalog-retrieval', version: '1.0.0', artifactHash: fakeHash('c'), parametersHash: fakeHash('d') },
        uncertainty: [{ source: 'cross_source_disagreement', representation: 'ordinal', rationale: 'The current public evidence sources disagree.', ordinal: { level: 'high', scaleId: 'poolday.uncertainty.v1', scaleVersion: '1.0.0' } }],
        feasibility: { status: 'feasible', requiredCapabilities: ['version-pinned public retrieval'], availability: 'The public catalog release is available.', materials: [], failureRisks: ['The historical public endpoint may be unavailable.'] },
        independence: { dimensions: ['source organization', 'curation process'], exclusions: ['Do not use a mirror of the first source.'], minimumIndependentExecutions: 1 },
        safety: { classification: 'public-data-only', requirements: ['Use only the public protein record.'], reviewRequired: true },
        consent: { publicSequenceRequired: true, publicEvidencePublicationRequired: true, additionalRequirements: [] },
        scientificCost: {
          compute: { amount: 1, unit: 'cpu-second', burden: 0 },
          money: { amount: 0, unit: 'USD', burden: 0 },
          labor: { amount: 0.25, unit: 'person-hour', burden: 1 },
          instrument: { amount: 0, unit: 'instrument-hour', burden: 0 },
          sample: { amount: 0, unit: 'sample', burden: 0 },
          elapsedTime: { amount: 0.25, unit: 'hour', burden: 1 },
          assumptions: ['The public endpoint remains available.']
        },
        expectedValue: {
          status: 'heuristic_not_calibrated',
          method: { id: 'curator-declared-ordinal-value', version: '1.0.0' },
          uncertaintyReduction: 4,
          decisionRelevance: 5,
          duplicateWorkAvoidance: 3,
          calibrationEvidenceHashes: []
        }
      }
    });
    for (const record of [
      firstSubmission, secondSubmission, firstResult, secondResult, annotation, review,
      prior, hypothesisOne, hypothesisTwo, resolutionPolicy, resolutionPolicyReview,
      predictionOne, predictionTwo, predictionReviewOne, predictionReviewTwo, order, orderReview,
      claimOne, claimTwo, cohort, cohortReview, outcomeOne, outcomeTwo, outcomeReviewOne, outcomeReviewTwo, evaluation,
      candidateAction
    ]) {
      await store.appendResearchRecord(record);
    }
  });

  await page.getByRole('link', { name: 'View room', exact: true }).click();
  await expect(page.locator('[data-pool-research-room]')).toBeVisible();
  await expect(page.locator('[data-pool-research-room]')).toContainText('Second public candidate');
  await expect(page.locator('.pool-room-timeline')).toContainText('Agreement assessed');
  await expect(page.getByText('Remembered evidence', { exact: true })).toBeAttached();
  await expect(page.locator('.pool-room-memory')).toContainText('Decision memory');
  await expect(page.locator('.pool-room-memory')).toContainText('Remembered does not mean biologically true.');
  await expect(page.locator('.pool-room-archive')).toContainText('Complete evidence archive');
  await expect(page.locator('.pool-room-archive [data-archive-state="failed"]')).toBeAttached();
  await page.locator('.pool-room-technical-disclosure > summary').click();
  await expect(page.locator('[data-pool-protein-campaign]')).toContainText('Public protein disagreements');
  await expect(page.locator('[data-pool-protein-campaign]')).toContainText('does not rank biological importance, truth, or execution priority');
  await expect(page.locator('.pool-room-resolution')).toContainText('Criteria missing');
  await expect(page.locator('.pool-room-resolution')).toContainText('cannot accept, reject, or close');
  await expect(page.locator('.pool-room-archive')).toContainText('Resolution criteria frozen');
  const contract = page.locator('.pool-room-contract');
  await expect(contract).toContainText('Checkpoint missing');
  await contract.getByRole('button', { name: 'Sign first checkpoint', exact: true }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const store = await import('/ui/pool-home/research-store.js');
    return store.loadResearchRecords('reploid-default')
      .filter((record) => record.kind === 'research_discovery_checkpoint').length;
  })).toBe(1);
  await expect(contract).toContainText('Current checkpoint');
  const roomApproval = page.locator('[data-pool-room-approve-candidate]').first();
  await expect(page.locator('.pool-room-action-card')).toContainText('Retrieve an independent pinned family annotation');
  await page.locator('.pool-room-action-card').getByText('Raw candidate-action evidence', { exact: true }).click();
  await expect(page.locator('.pool-room-action-card')).toContainText('0 USD · burden 0/5');
  await expect(page.locator('.pool-room-action-card')).toContainText('Ranking projection only; no allocation or execution authority.');
  await expect(roomApproval).toBeVisible();
  await roomApproval.click();
  await expect(page.locator('[data-pool-room-approve-candidate]')).toHaveCount(0);

  await page.evaluate(async () => {
    const evidence = await import('/pool/evidence-network.js');
    const receipts = await import('/pool/inference-receipt.js');
    const store = await import('/ui/pool-home/research-store.js');
    const createIdentity = async (id) => {
      const keyPair = await receipts.createSigningKeyPair();
      return {
        resolve: async () => ({
          kind: 'reviewer',
          roleId: 'reviewer_correction',
          userId: `user_${id}`,
          deviceId: `device_${id}`,
          identityRootId: `root_${id}`
        }),
        getSigningKeyPair: async () => keyPair
      };
    };
    const records = store.loadResearchRecords('reploid-default');
    const target = [...records]
      .filter((record) => record.kind === 'research_result')
      .sort((left, right) => (
        Date.parse(left.createdAt || '') - Date.parse(right.createdAt || '')
        || String(left.recordHash).localeCompare(String(right.recordHash))
      ))
      .at(-1);
    const correction = await evidence.createSignedHumanClaim({
      identity: await createIdentity('correction-author'),
      roomId: 'reploid-default',
      targetHash: target.recordHash,
      claimKind: 'correction',
      relation: 'corrects',
      text: 'The result is corrected because its evidence needs a fresh receipt link.',
      confidence: 0.95
    });
    const correctionReview = await evidence.createSignedHumanClaim({
      identity: await createIdentity('correction-reviewer'),
      roomId: 'reploid-default',
      targetHash: correction.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'The correction is attributable and accepted for room memory.',
      confidence: 0.95,
      decision: 'accepted'
    });
    await store.appendResearchRecord(correction);
    await store.appendResearchRecord(correctionReview);
  });
  await expect(page.locator('[data-room-result-card]')).toContainText('corrected');
  await expect(page.getByText('Result corrected', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.pool-room-timeline')).toContainText('Correction attached');
  await expect(page.locator('.pool-room-memory')).toContainText('Correction attached');
  await expect(page.locator('.pool-room-archive [data-archive-state="superseded"]')).toBeAttached();
  await expect(page.locator('.pool-room-archive [data-archive-state="corrected"]')).toBeAttached();
  await expect(contract).toContainText('Reopening must be checkpointed');
  await page.locator('.pool-room-technical-disclosure').evaluate((details) => { details.open = true; });
  await contract.getByRole('button', { name: 'Sign reopened checkpoint', exact: true }).click();
  await expect.poll(async () => page.evaluate(async () => {
    const store = await import('/ui/pool-home/research-store.js');
    return store.loadResearchRecords('reploid-default')
      .filter((record) => record.kind === 'research_discovery_checkpoint').length;
  })).toBe(2);
  await expect(contract).toContainText('Reopened state checkpointed');

  const resultReviewLink = page.locator('[data-room-result-card]').getByRole('link', { name: 'Review', exact: true });
  const reviewHref = await resultReviewLink.getAttribute('href');
  const reviewedTarget = new URL(reviewHref, 'http://localhost').searchParams.get('target');
  const persistedBeforeReviewNavigation = await page.evaluate(() => JSON.parse(
    localStorage.getItem('reploid.pool.research-evidence.v1::reploid-default') || '[]'
  ).length);
  expect(persistedBeforeReviewNavigation).toBeGreaterThan(0);
  await resultReviewLink.click();
  await expect(page).toHaveURL(new RegExp(`/records\\?room=reploid-default&panel=review&target=${encodeURIComponent(reviewedTarget)}`));
  await expect.poll(async () => page.evaluate(async () => {
    const store = await import('/ui/pool-home/research-store.js');
    return store.loadResearchRecords('reploid-default').length;
  }), { timeout: 60000, message: 'verified local research history should rehydrate before review' })
    .toBeGreaterThan(0);
  await expect(page.locator('.pool-room-secondary-workspace')).toHaveAttribute('open', '');
  const contextualReview = page.locator('[data-research-review-form]');
  await expect(contextualReview.locator('select[name="targetHash"]')).toHaveValue(reviewedTarget);
  await expect(contextualReview.getByRole('button', { name: 'Accept evidence', exact: true })).toBeVisible();
  await expect(contextualReview.getByRole('button', { name: 'Reject evidence', exact: true })).toBeVisible();
  await expect(contextualReview.getByRole('button', { name: 'Attach correction', exact: true })).toBeVisible();
  await expect(contextualReview.getByRole('button', { name: 'Request replication', exact: true })).toBeVisible();
  await contextualReview.locator('textarea[name="text"]').fill('The receipt, model identity, and visible limits support this acceptance.');
  await contextualReview.getByRole('button', { name: 'Accept evidence', exact: true }).click();
  await expect(page.locator('[data-research-review-status]')).toContainText(/Signed review record (published|saved locally)/);
  const persistedReview = await page.evaluate((targetHash) => {
    const key = 'reploid.pool.research-evidence.v1::reploid-default';
    return JSON.parse(localStorage.getItem(key) || '[]').find((record) => (
      record.kind === 'human_claim'
      && record.targetHash === targetHash
      && record.claim?.kind === 'review_decision'
      && record.claim?.decision === 'accepted'
    ));
  }, reviewedTarget);
  expect(persistedReview?.signature).toBeTruthy();

  await page.goto('/records');
  await expect(page.locator('.pool-room-secondary-workspace')).toBeVisible();
  await expect(page.locator('[data-pool-research-workspace]')).toBeHidden();
  await page.locator('.pool-room-secondary-workspace > summary').click();
  await expect(page.locator('[data-pool-research-workspace]')).toBeVisible();
  await expect(page.getByText('Exact-model evidence, not vector averaging', { exact: true })).toBeVisible();
  await expect(page.locator('.pool-research-model-evidence p').filter({ hasText: 'No cross-model agreement is asserted because only one or no exact model contract has published evidence.' }).first()).toBeVisible();
  await expect(page.locator('.pool-research-panel').filter({ hasText: 'Model vectors and tokenizer-local logits remain isolated by exact contract.' }).first()).toBeVisible();
  await expect(page.locator('.pool-research-stats div').filter({ hasText: 'Submissions' }).locator('dd')).toHaveText('2');
  await expect(page.locator('.pool-research-stats div').filter({ hasText: 'Hypotheses' }).locator('dd')).toHaveText('2');
  await expect(page.locator('.pool-research-stats div').filter({ hasText: 'Predictions' }).locator('dd')).toHaveText('2');
  await expect(page.locator('.pool-research-stats div').filter({ hasText: 'Outcomes' }).locator('dd')).toHaveText('2');
  await expect(page.locator('.pool-research-stats div').filter({ hasText: 'Frozen cohorts' }).locator('dd')).toHaveText('1');
  await expect(page.locator('.pool-research-stats div').filter({ hasText: 'Cohort evaluations' }).locator('dd')).toHaveText('1');
  await expect(page.locator('.pool-research-stats div').filter({ hasText: 'Candidate actions' }).locator('dd')).toHaveText('1');
  await expect(page.getByText('accepted annotations', { exact: false })).toBeVisible();
  await expect(page.getByText('deterministic similarity clusters', { exact: false })).toBeVisible();
  await expect(page.locator('.pool-research-record b').filter({ hasText: 'The independent replica retained a high-variance failure.' })).toBeVisible();
  await expect(page.getByText('balanced_accuracy improved', { exact: false })).toBeVisible();
  const priorEvidenceForm = page.locator('[data-research-action="prior-evidence"]');
  await expect(priorEvidenceForm).toBeAttached();
  await priorEvidenceForm.locator('xpath=..').locator('summary').click();
  await priorEvidenceForm.locator('[data-prior-evidence-kind]').selectOption('annotation');
  await expect(priorEvidenceForm.locator('[data-protein-annotation-fields]')).toBeVisible();
  await expect(priorEvidenceForm.locator('[name="ontologyNamespace"]')).toHaveAttribute('required', '');
  await priorEvidenceForm.locator('[data-prior-evidence-kind]').selectOption('assay');
  await expect(priorEvidenceForm.locator('[data-protein-annotation-fields]')).toBeHidden();
  await expect(priorEvidenceForm.locator('[data-public-evidence-finding]')).toBeVisible();
  await expect(priorEvidenceForm.locator('[name="findingClassification"]')).toHaveAttribute('required', '');
  await priorEvidenceForm.locator('[data-prior-evidence-kind]').selectOption('negative_result');
  await expect(priorEvidenceForm.locator('[name="findingClassification"]')).toHaveValue('negative');
  await expect(priorEvidenceForm.locator('[name="findingClassification"]')).toBeDisabled();
  await priorEvidenceForm.locator('[data-prior-evidence-kind]').selectOption('failed_attempt');
  await expect(priorEvidenceForm.locator('[data-public-evidence-failure]')).toBeVisible();
  await expect(priorEvidenceForm.locator('[name="failureCategory"]')).toHaveAttribute('required', '');
  await expect(page.locator('[data-research-action="adjudication-experiment"]')).toBeAttached();
  await expect(page.locator('[data-research-action="adjudication-experiment"] [name="baselinePolicyArtifactHash"]')).toBeAttached();
  await expect(page.locator('[data-research-action="adjudication-experiment"] [name="outcomeBoundaryMode"]')).toHaveValue('prospective_future');
  await expect(page.locator('[data-research-action="adjudication-experiment"] [name="sameEvidenceCutoff"]')).toBeAttached();
  await expect(page.locator('[data-research-action="adjudication-experiment"] [name="informationGainMetricId"]')).toBeAttached();
  await expect(page.locator('[data-research-action="adjudication-evaluation"] [name="heldOutFamilyBaselineValue"]')).toBeAttached();
  await expect(page.locator('[data-research-action="adjudication-evaluation"]')).toBeAttached();
  await expect(page.locator('.pool-room-adjudication-proof')).toContainText('Reploid has not demonstrated its first product win.');
  await expect(page.locator('[data-research-action="work-order"]')).toBeAttached();
  await expect(page.locator('[data-research-action="resolution-policy"]')).toBeAttached();
  await expect(page.locator('[data-research-action="resolution-policy"] [name="closureMinimumReviewers"]')).toBeAttached();
  await expect(page.locator('[data-research-action="work-order"] [name="workAnalysisArtifactHash"]')).toBeAttached();
  await expect(page.locator('[data-research-action="work-order"] [name="allowedFailureCategories"]')).toBeAttached();
  await expect(page.locator('[data-research-action="work-order"] [name="custodyArtifactHash"]')).toBeAttached();
  await expect(page.locator('[data-research-action="work-order"] [name="replicationIndependentDimensions"]')).toBeAttached();
  await expect(page.locator('[data-research-action="work-order"] [name="workBiosafety"]')).toBeAttached();
  await expect(page.locator('[data-research-action="work-order"] [name="scopePublicNonClinical"]')).toBeAttached();
  await expect(page.locator('[data-research-action="work-order"] [name="scopeNoAuthority"]')).toBeAttached();
  await expect(page.locator('[data-research-action="work-order"] [name="workPublicationLicense"]')).toBeAttached();
  await expect(page.locator('[data-research-action="work-order"] [name="publishFailures"]')).toBeAttached();
  await expect(page.locator('[data-research-action="work-claim"] [name="institutionIdentityHash"]')).toBeAttached();
  await expect(page.locator('[data-research-action="work-claim"] [name="capabilityEvidenceHash"]')).toBeAttached();
  await expect(page.locator('[data-research-action="work-claim"] [name="protocolCustodyEvidenceHash"]')).toBeAttached();
  await expect(page.locator('[data-research-action="work-claim"] [name="safetyApprovalHash"]')).toBeAttached();
  await expect(page.locator('[data-research-action="work-claim"] [name="laboratorySafetyClassification"]')).toHaveValue('public_non_pathogenic_non_clinical');
  await expect(page.locator('[data-research-action="work-claim"] [name="laboratoryAvailableUntil"]')).toBeAttached();
  await expect(page.locator('[data-research-action="outcome"]')).toBeAttached();
  await expect(page.locator('[data-research-action="outcome"] [name="instrumentIdentityHash"]')).toBeAttached();
  await expect(page.locator('[data-research-action="outcome"] [name="analysisExecutionHash"]')).toBeAttached();
  await expect(page.locator('[data-research-action="cohort"]')).toBeAttached();
  await expect(page.locator('[data-research-action="evaluation"]')).toBeAttached();
  await expect(page.locator('[data-research-action="candidate-action"]')).toBeAttached();
  await expect(page.locator('[data-research-action="revocation"]')).toBeAttached();
  const reviewContext = page.locator('[data-research-review-context]').first();
  await expect(reviewContext).toContainText('Question');
  await expect(reviewContext).toContainText('Sequence');
  await expect(reviewContext).toContainText('Similarity and retrieval ranking do not establish agreement.');
  await page.locator('[data-research-review-form] select[name="targetHash"]').selectOption({ index: 2 });
  const selectedReviewContext = page.locator('[data-research-review-context-shell]:not([hidden])');
  await expect(selectedReviewContext).toContainText('Result evidence');
  await expect(selectedReviewContext).toContainText('Agreement');
  await expect(selectedReviewContext).toContainText('receipt');

  const governedCandidate = page.locator('[data-research-candidate-action]').filter({ hasText: 'Retrieve an independent pinned family annotation' });
  await expect(governedCandidate).toContainText('Highest-ranked admitted candidate');
  await governedCandidate.locator('summary').click();
  await expect(governedCandidate).toContainText('cross source disagreement: ordinal');
  await expect(governedCandidate).toContainText('0 USD · burden 0/5');
  await expect(governedCandidate).toContainText('Proposal and ranking have no allocation or execution authority.');
  await expect(governedCandidate).toContainText('Independently approved');
  await expect(governedCandidate.locator('[data-research-approve-candidate]')).toHaveCount(0);

  await page.locator('[data-research-search]').fill('hydrophobic');
  await expect(page.locator('.pool-research-record b').filter({ hasText: 'Reviewed hydrophobic N-terminus evidence.' })).toBeVisible();
  await expect(page.locator('.pool-research-record')).toHaveCount(1);

  const approve = page.locator('[data-research-approve-task]').first();
  await expect(approve).toBeVisible();
  await approve.click();
  await expect(page.locator('.pool-research-tasks strong').filter({ hasText: 'Approved' }).first()).toBeVisible();

  await page.evaluate(async () => {
    const store = await import('/ui/pool-home/research-store.js');
    const key = `${store.POOLDAY_RESEARCH_STORAGE_KEY}::reploid-default`;
    const records = JSON.parse(localStorage.getItem(key) || '[]');
    localStorage.setItem(key, JSON.stringify(records.reverse()));
  });
  await page.reload();
  await expect(page.locator('[data-pool-research-room]')).toHaveAttribute('data-room-id', 'reploid-default');
  await expect(page.locator('[data-room-result-card]')).toContainText('Model evidence');
  await page.goto('/?room=reploid-default');
  await expect(page.locator('[data-pool-research-room]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'View room', exact: true })).toHaveAttribute('href', '/records?room=reploid-default');
  await page.getByRole('link', { name: 'View room', exact: true }).click();
  await expect(page.locator('[data-room-result-card]')).toContainText('Model evidence');
  await expect(page.locator('[data-room-result-card]')).toContainText('corrected');
  await expect(page.locator('.pool-room-timeline')).toContainText('Correction attached');

  await page.goto('/ask?room=journey-room');
  await expect(page.locator('[data-pool-research-room]')).toHaveCount(0);
  await page.locator('.pool-nav-link[data-pool-route-link="/records?room=journey-room"]').click();
  await expect(page).toHaveURL(/\/records\?room=journey-room$/);
  await expect(page.locator('[data-pool-research-room]')).toHaveAttribute('data-room-id', 'journey-room');
  await page.goto('/history?room=journey-room');
  await expect(page.locator('[data-pool-research-room]')).toHaveAttribute('data-room-id', 'journey-room');
  await expect(page.locator('#pool-record-ledger')).toHaveAttribute('data-record-facet', 'room');
  await page.goto('/network?room=journey-room');
  await expect(page.locator('[data-pool-research-room]')).toHaveAttribute('data-room-id', 'journey-room');
  await expect(page.locator('[data-pool-room-contextual-panel="discovery"]')).toBeVisible();
  await expect(page.locator('.pool-room-secondary-workspace')).toHaveAttribute('open', '');
  await page.reload();
  await expect(page.locator('[data-pool-research-room]')).toHaveAttribute('data-room-id', 'journey-room');
  expect(pageErrors).toEqual([]);
});

test('restores empty unsent room fields instead of replacing them with defaults', async ({ page }) => {
  const room = 'draft-recovery-room';
  await page.goto(`/ask?room=${room}`);
  await page.locator('#pool-run-prompt').fill('');
  await page.locator('#pool-run-intent-text').fill('Add the sequence after review context is ready.');

  await page.goto(`/?room=${room}`);
  await page.goto(`/ask?room=${room}`);

  await expect(page.locator('#pool-run-prompt')).toHaveValue('');
  await expect(page.locator('#pool-run-intent-text')).toHaveValue('Add the sequence after review context is ready.');
});

test('retrieves and attaches licensed exact-sequence evidence without inheriting origin-room acceptance', async ({ page, browser }) => {
  const pageErrors = [];
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const originRoomId = `reuse-origin-${runId}`;
  const currentRoomId = `reuse-current-${runId}`;
  const sourceAccession = `E2E-REUSE-${runId}`;
  const aminoAcids = 'ACDEFGHIKLMNPQRSTVWY';
  const sequence = `MPEPTIDERKLMNPQ${[...runId]
    .map((character) => aminoAcids[character.charCodeAt(0) % aminoAcids.length])
    .join('')}`;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  const seeded = await page.evaluate(async ({ runId, originRoomId, currentRoomId, sourceAccession, sequence }) => {
    const evidence = await import('/pool/evidence-network.js');
    const receipts = await import('/pool/inference-receipt.js');
    const models = await import('/pool/model-contract.js');
    const sdkModule = await import('/pool/sdk.js');
    const sdk = sdkModule.createPoolSdk();
    const identity = async (kind, id) => {
      const keyPair = await receipts.createSigningKeyPair();
      return {
        resolve: async () => ({
          kind,
          roleId: `${kind}_${id}`,
          userId: `user_${id}`,
          deviceId: `device_${id}`,
          identityRootId: `root_${id}`
        }),
        getSigningKeyPair: async () => keyPair
      };
    };
    const modelContract = models.buildLaunchProviderModel();
    const originQuestion = await evidence.createSignedResearchSubmission({
      identity: await identity('requester', `reuse-origin-requester-${runId}`),
      roomId: originRoomId,
      sequence,
      intent: { kind: 'question', text: 'What does the versioned public catalog say?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract,
      policyId: 'redundant_agreement'
    });
    const prior = await evidence.createSignedPriorEvidence({
      identity: await identity('researcher', `reuse-origin-researcher-${runId}`),
      roomId: originQuestion.roomId,
      questionHash: originQuestion.recordHash,
      evidenceKind: 'annotation',
      summary: 'Version seven assigns a bounded public domain annotation.',
      reference: { accession: sourceAccession, version: '7' },
      annotation: {
        scope: 'domain',
        ontology: { namespace: 'E2E', termId: 'DOMAIN:123', version: '7', label: 'Bounded public domain' },
        sequence: { hash: originQuestion.sequence.hash, length: originQuestion.sequence.length },
        coordinates: { sourceSystem: 'protein_residue_zero_based_half_open', sourceStart: 1, sourceEnd: 12 }
      },
      provenance: { retrievalMethod: 'version-pinned catalog API', license: 'CC BY 4.0' }
    });
    const acceptance = await evidence.createSignedHumanClaim({
      identity: await identity('reviewer', `reuse-origin-reviewer-${runId}`),
      roomId: originQuestion.roomId,
      targetHash: prior.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'Accept this versioned source in the origin room.',
      confidence: 0.9,
      decision: 'accepted'
    });
    for (const record of [originQuestion, prior, acceptance]) {
      await sdk.publishResearchRecord(record);
    }
    const currentQuestion = await evidence.createSignedResearchSubmission({
      identity: await identity('requester', `reuse-current-requester-${runId}`),
      roomId: currentRoomId,
      sequence,
      intent: { kind: 'question', text: 'Should this disputed domain annotation be retained here?' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract,
      policyId: 'redundant_agreement'
    });
    await sdk.publishResearchRecord(currentQuestion);
    return {
      sourceHash: prior.recordHash,
      currentQuestionHash: currentQuestion.recordHash
    };
  }, { runId, originRoomId, currentRoomId, sourceAccession, sequence });

  await page.goto(`/records?room=${encodeURIComponent(currentRoomId)}`);
  await page.locator('.pool-room-technical-disclosure > summary').click();
  const priorSection = page.locator('.pool-room-prior-evidence');
  await expect(priorSection).toContainText('Version seven assigns a bounded public domain annotation.');
  await expect(priorSection).toContainText('CC BY 4.0');
  await expect(priorSection).toContainText('canonical residues 2-12');
  await expect(priorSection).toContainText('declared context differences');
  const attach = priorSection.locator(`[data-pool-room-attach-prior="${seeded.sourceHash}"]`);
  await expect(attach).toBeVisible();
  await expect(page.locator('.pool-room-memory .pool-room-count')).toHaveText('0');

  await attach.click();

  await expect(priorSection).toContainText('Attached for current-room review');
  await expect(priorSection.locator('[data-pool-room-attach-prior]')).toHaveCount(0);
  await expect(page.locator('.pool-room-memory .pool-room-count')).toHaveText('0');
  const attached = await page.evaluate(async ({ sourceHash, currentQuestionHash, currentRoomId }) => {
    const store = await import('/ui/pool-home/research-store.js');
    return store.loadResearchRecords(currentRoomId).find((record) => (
      record.kind === 'research_prior_evidence'
      && record.questionHash === currentQuestionHash
      && record.evidence?.reference?.contentHash === sourceHash
    ));
  }, { ...seeded, currentRoomId });
  expect(attached).toMatchObject({
    evidence: {
      reuseContext: {
        schema: 'poolday.cross_room_reuse_context/v1',
        admission: 'requires_explicit_current_room_context_review',
        comparison: { status: 'declared_context_differences' },
        originSource: {
          schema: 'poolday.cross_room_source_identity/v1',
          evidenceKind: 'annotation',
          reference: { accession: sourceAccession, version: '7' }
        }
      },
      annotation: {
        schema: 'poolday.protein_annotation_identity/v1',
        scope: 'domain',
        coordinates: { canonicalSystem: 'protein_residue_one_based_closed', start: 2, end: 12 }
      },
      provenance: {
        retrievalMethod: 'Reploid exact-sequence prior-room lookup',
        license: 'CC BY 4.0'
      }
    }
  });
  expect(attached.signature).toBeTruthy();

  const reviewerContext = await browser.newContext();
  const reviewerPage = await reviewerContext.newPage();
  reviewerPage.on('pageerror', (error) => pageErrors.push(error.message));
  await reviewerPage.goto(new URL(`/records?room=${encodeURIComponent(currentRoomId)}`, page.url()).toString());
  await reviewerPage.locator('.pool-room-secondary-workspace > summary').click();
  const reviewForm = reviewerPage.locator('[data-research-review-form]');
  await reviewForm.locator('select[name="targetHash"]').selectOption(attached.recordHash);
  const contextDetermination = reviewForm.locator('select[name="contextDetermination"]');
  await expect(contextDetermination).toBeVisible();
  await expect(reviewForm).toContainText('declared context differences');
  await reviewForm.locator('textarea[name="text"]').fill('The bounded domain evidence remains relevant to this current annotation decision.');
  await contextDetermination.selectOption('uncertain');
  await reviewForm.getByRole('button', { name: 'Accept evidence', exact: true }).click();
  await expect(reviewForm.locator('[data-research-review-status]')).toContainText('explicit relevant context determination');
  await contextDetermination.selectOption('relevant');
  await reviewForm.getByRole('button', { name: 'Accept evidence', exact: true }).click();
  await expect(reviewerPage.locator('[data-research-review-status]')).toContainText(/Signed review record (published|saved locally)/);

  await page.reload();
  await page.locator('.pool-room-technical-disclosure > summary').click();
  await expect(page.locator('.pool-room-memory .pool-room-count')).toHaveText('1');
  await reviewerContext.close();
  expect(pageErrors).toEqual([]);
});

test('passes governed Research Room browser modules through the Verification Worker', async ({ page }) => {
  await page.goto('/');
  const paths = [
    '/pool/discovery-action-value.js',
    '/pool/discovery-candidate-action.js',
    '/pool/discovery-contract.js',
    '/pool/evidence-network.js',
    '/pool/protein-uncertainty-campaign.js',
    '/pool/research-cycle.js',
    '/ui/pool-home/requester-controls.js',
    '/ui/pool-home/research-panels.js',
    '/ui/pool-home/research-store.js',
    '/ui/pool-home/research-view.js',
    '/ui/pool-home/room-projection.js',
    '/ui/pool-home/room-view.js'
  ];
  const verification = await page.evaluate(async (modulePaths) => {
    const snapshot = Object.fromEntries(await Promise.all(modulePaths.map(async (path) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Could not load ${path}: ${response.status}`);
      return [path, await response.text()];
    })));
    return new Promise((resolve, reject) => {
      const worker = new Worker('/core/verification-worker.js');
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('Verification Worker did not respond'));
      }, 10000);
      worker.onmessage = (event) => {
        clearTimeout(timeout);
        worker.terminate();
        resolve(event.data);
      };
      worker.onerror = (event) => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(event.message));
      };
      worker.postMessage({ type: 'VERIFY', snapshot, options: { quickMode: true } });
    });
  }, paths);

  expect(verification).toMatchObject({
    passed: true,
    errors: [],
    details: { filesAnalyzed: paths.length }
  });
});

test('Verification Worker rejects malformed ES modules without rewriting or executing them', async ({ page }) => {
  await page.goto('/');
  const verification = await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Verification Worker did not respond'));
    }, 10000);
    worker.onmessage = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage({
      type: 'VERIFY',
      snapshot: {
        '/core/valid-esm.js': "import { value } from './dependency.js'\nexport const doubled = value * 2\n",
        '/core/malformed-import.js': "import { value from './dependency.js';\nexport const doubled = value * 2;\n",
        '/core/semicolonless-truncation.js': "import {\n  value\n} from './dependency.js'\nconst incomplete =\n"
      },
      options: { quickMode: true }
    });
  }));

  expect(verification.passed).toBe(false);
  expect(verification.errors).toEqual(expect.arrayContaining([
    expect.stringContaining('/core/malformed-import.js'),
    expect.stringContaining('/core/semicolonless-truncation.js')
  ]));
  expect(verification.errors.some((error) => error.includes('/core/valid-esm.js'))).toBe(false);
});
