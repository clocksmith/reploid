import { expect, test } from '@playwright/test';

test('shows and exercises the governed protein evidence journey', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');

  await expect(page.getByText('Submit → compute → review → connect → discover', { exact: false }).first()).toBeVisible();
  await expect(page.locator('.pool-home-purpose-steps li')).toHaveCount(5);
  await expect(page.locator('#pool-home-research-public')).toBeAttached();
  await expect(page.locator('#pool-home-intent-text')).toBeAttached();

  await page.evaluate(async () => {
    const evidence = await import('/pool/evidence-network.js');
    const receipts = await import('/pool/inference-receipt.js');
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
    const model = {
      id: 'esm2-e2e',
      hash: fakeHash('1'),
      manifestHash: fakeHash('2'),
      runtime: 'doppler',
      backend: 'browser-webgpu',
      workload: 'sequence.embedding.v1',
      executionMode: 'full_model_browser_sequence',
      dimensions: 3
    };
    const requester = await createIdentity('requester', 'e2e-requester');
    const researcher = await createIdentity('researcher', 'e2e-researcher');
    const curator = await createIdentity('reviewer', 'e2e-curator');
    const independent = await createIdentity('reviewer', 'e2e-independent');
    const laboratoryOne = await createIdentity('researcher', 'e2e-laboratory-one');
    const laboratoryTwo = await createIdentity('researcher', 'e2e-laboratory-two');
    const evaluator = await createIdentity('verifier', 'e2e-evaluator');
    const createSubmission = (sequence, label) => evidence.createSignedResearchSubmission({
      identity: requester,
      roomId: 'reploid-default',
      sequence,
      intent: { kind: 'hypothesis', text: `Review ${label} against public evidence.`, label },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
      modelContract: model,
      policyId: 'redundant_agreement'
    });
    const firstSubmission = await createSubmission('MAPLALLLLGLVAGA', 'First public candidate');
    const secondSubmission = await createSubmission('MKVLVVLLCLVPAYG', 'Second public candidate');
    const createResult = (submission, vector, receiptCharacter) => evidence.createSignedResearchResult({
      identity: requester,
      submission,
      receiptRecord: {
        receiptHash: fakeHash(receiptCharacter),
        verifierDecision: { accepted: true },
        receipt: {
          model,
          providerId: `provider_${receiptCharacter}`,
          assignmentId: `assignment_${receiptCharacter}`,
          jobId: `job_${receiptCharacter}`,
          outputKind: 'sequence.embedding.v1',
          vectorHash: fakeHash('c')
        }
      },
      agreement: { status: 'accepted', receiptHashes: [fakeHash(receiptCharacter), fakeHash('d')] },
      embedding: vector
    });
    const firstResult = await createResult(firstSubmission, [1, 0, 0], 'a');
    const secondResult = await createResult(secondSubmission, [0.99, 0.01, 0], 'b');
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
    const order = await evidence.createSignedResearchWorkOrder({
      identity: curator,
      roomId: 'reploid-default',
      questionHash: firstSubmission.recordHash,
      hypothesisHashes: [hypothesisOne.recordHash, hypothesisTwo.recordHash],
      title: 'E2E blinded secretory assay',
      protocol,
      replicaTarget: 2,
      blindness: { required: true, allocationHash: fakeHash('6') }
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
      laboratory: { id: 'e2e-lab-one', name: 'E2E Laboratory One' },
      capabilities: ['secretory reporter assay'],
      consent: { publicLaboratoryIdentity: true, publishOutcome: true }
    });
    const claimTwo = await evidence.createSignedResearchWorkClaim({
      identity: laboratoryTwo,
      roomId: 'reploid-default',
      workOrderHash: order.recordHash,
      laboratory: { id: 'e2e-lab-two', name: 'E2E Laboratory Two' },
      capabilities: ['independent secretory reporter replication'],
      consent: { publicLaboratoryIdentity: true, publishOutcome: true }
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
      analysis: { methodId: 'e2e-analysis', version: '1.0.0', artifactHash: fakeHash('7') },
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
      analysis: { methodId: 'e2e-analysis', version: '1.0.0', artifactHash: fakeHash('7'), lineageHashes: [outcomeOne.recordHash] },
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
    for (const record of [
      firstSubmission, secondSubmission, firstResult, secondResult, annotation, review,
      prior, hypothesisOne, hypothesisTwo, predictionOne, predictionTwo, order, orderReview,
      claimOne, claimTwo, cohort, outcomeOne, outcomeTwo, outcomeReviewOne, outcomeReviewTwo, evaluation
    ]) {
      await store.appendResearchRecord(record);
    }
  });

  await page.goto('/records');
  await expect(page.locator('[data-pool-research-workspace]')).toBeVisible();
  await expect(page.getByText('Exact-model evidence, not vector averaging', { exact: true })).toBeVisible();
  await expect(page.locator('.pool-research-model-evidence p').filter({ hasText: 'No cross-model agreement is asserted because only one or no exact model contract has published evidence.' }).first()).toBeVisible();
  await expect(page.locator('.pool-research-panel').filter({ hasText: 'Model vectors and tokenizer-local logits remain isolated by exact contract.' }).first()).toBeVisible();
  await expect(page.locator('.pool-research-stats div').filter({ hasText: 'Submissions' }).locator('dd')).toHaveText('2');
  await expect(page.locator('.pool-research-stats div').filter({ hasText: 'Hypotheses' }).locator('dd')).toHaveText('2');
  await expect(page.locator('.pool-research-stats div').filter({ hasText: 'Predictions' }).locator('dd')).toHaveText('2');
  await expect(page.locator('.pool-research-stats div').filter({ hasText: 'Outcomes' }).locator('dd')).toHaveText('2');
  await expect(page.locator('.pool-research-stats div').filter({ hasText: 'Frozen cohorts' }).locator('dd')).toHaveText('1');
  await expect(page.locator('.pool-research-stats div').filter({ hasText: 'Evaluations' }).locator('dd')).toHaveText('1');
  await expect(page.getByText('accepted annotations', { exact: false })).toBeVisible();
  await expect(page.getByText('deterministic similarity clusters', { exact: false })).toBeVisible();
  await expect(page.locator('.pool-research-record b').filter({ hasText: 'The independent replica retained a high-variance failure.' })).toBeVisible();
  await expect(page.getByText('balanced_accuracy improved', { exact: false })).toBeVisible();
  await expect(page.locator('[data-research-action="prior-evidence"]')).toBeAttached();
  await expect(page.locator('[data-research-action="work-order"]')).toBeAttached();
  await expect(page.locator('[data-research-action="outcome"]')).toBeAttached();
  await expect(page.locator('[data-research-action="cohort"]')).toBeAttached();
  await expect(page.locator('[data-research-action="evaluation"]')).toBeAttached();
  await expect(page.locator('[data-research-action="revocation"]')).toBeAttached();

  await page.locator('[data-research-search]').fill('hydrophobic');
  await expect(page.locator('.pool-research-record b').filter({ hasText: 'Reviewed hydrophobic N-terminus evidence.' })).toBeVisible();
  await expect(page.locator('.pool-research-record')).toHaveCount(1);

  const approve = page.locator('[data-research-approve-task]').first();
  await expect(approve).toBeVisible();
  await approve.click();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});
