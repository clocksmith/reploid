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
      prior, hypothesisOne, hypothesisTwo, predictionOne, predictionTwo, predictionReviewOne, predictionReviewTwo, order, orderReview,
      claimOne, claimTwo, cohort, cohortReview, outcomeOne, outcomeTwo, outcomeReviewOne, outcomeReviewTwo, evaluation
    ]) {
      await store.appendResearchRecord(record);
    }
  });

  await expect(page.locator('[data-pool-research-room]')).toBeVisible();
  await expect(page.locator('[data-pool-room-recovery]')).toBeVisible();
  await expect(page.locator('[data-recovery-state="awaiting_review"]')).toBeVisible();
  await expect(page.locator('.pool-room-timeline')).toContainText('Agreement assessed');
  await expect(page.getByText('Remembered evidence', { exact: true })).toBeAttached();
  const roomApproval = page.locator('[data-pool-room-approve-task]').first();
  await expect(roomApproval).toBeVisible();
  await roomApproval.click();
  await expect(page.getByText('Inspect approved action', { exact: true }).first()).toBeVisible();

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

  const resultReviewLink = page.locator('[data-room-result-card]').getByRole('link', { name: 'Review this result', exact: true });
  const reviewHref = await resultReviewLink.getAttribute('href');
  const reviewedTarget = new URL(reviewHref, 'http://localhost').searchParams.get('target');
  const persistedBeforeReviewNavigation = await page.evaluate(() => JSON.parse(
    localStorage.getItem('reploid.pool.research-evidence.v1::reploid-default') || '[]'
  ).length);
  expect(persistedBeforeReviewNavigation).toBeGreaterThan(0);
  await resultReviewLink.click();
  await expect(page).toHaveURL(new RegExp(`/records\\?room=reploid-default&panel=review&target=${encodeURIComponent(reviewedTarget)}`));
  const reviewDiagnostics = await page.evaluate(async () => {
    const store = await import('/ui/pool-home/research-store.js');
    const storageKey = 'reploid.pool.research-evidence.v1::reploid-default';
    return {
      memoryCount: store.loadResearchRecords('reploid-default').length,
      persistedCount: JSON.parse(localStorage.getItem(storageKey) || '[]').length,
      rejectedRecords: store.getResearchSyncState('reploid-default').rejectedRecords
    };
  });
  expect(reviewDiagnostics.memoryCount, JSON.stringify(reviewDiagnostics)).toBeGreaterThan(0);
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
  const reviewContext = page.locator('[data-research-review-context]').first();
  await expect(reviewContext).toContainText('Question');
  await expect(reviewContext).toContainText('Sequence');
  await expect(reviewContext).toContainText('Similarity and retrieval ranking do not establish agreement.');
  await page.locator('[data-research-review-form] select[name="targetHash"]').selectOption({ index: 2 });
  const selectedReviewContext = page.locator('[data-research-review-context-shell]:not([hidden])');
  await expect(selectedReviewContext).toContainText('Result evidence');
  await expect(selectedReviewContext).toContainText('Agreement');
  await expect(selectedReviewContext).toContainText('receipt');

  await page.locator('[data-research-search]').fill('hydrophobic');
  await expect(page.locator('.pool-research-record b').filter({ hasText: 'Reviewed hydrophobic N-terminus evidence.' })).toBeVisible();
  await expect(page.locator('.pool-research-record')).toHaveCount(1);

  const approve = page.locator('[data-research-approve-task]').first();
  await expect(approve).toBeVisible();
  await approve.click();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();

  await page.evaluate(async () => {
    const store = await import('/ui/pool-home/research-store.js');
    const key = `${store.POOLDAY_RESEARCH_STORAGE_KEY}::reploid-default`;
    const records = JSON.parse(localStorage.getItem(key) || '[]');
    localStorage.setItem(key, JSON.stringify(records.reverse()));
  });
  await page.reload();
  await expect(page.locator('[data-pool-research-room]')).toHaveAttribute('data-room-id', 'reploid-default');
  await expect(page.locator('[data-room-result-card]')).toContainText('Inspectable model evidence');
  await page.goto('/?room=reploid-default');
  await expect(page.locator('[data-pool-research-room]')).toHaveAttribute('data-room-id', 'reploid-default');
  await expect(page.locator('[data-room-result-card]')).toContainText('Inspectable model evidence');
  await expect(page.locator('[data-room-result-card]')).toContainText('corrected');
  await expect(page.locator('.pool-room-timeline')).toContainText('Correction attached');

  await page.goto('/ask?room=journey-room');
  await expect(page.locator('[data-pool-research-room]')).toHaveAttribute('data-room-id', 'journey-room');
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

test('passes governed Research Room browser modules through the Verification Worker', async ({ page }) => {
  await page.goto('/');
  const paths = [
    '/pool/discovery-action-value.js',
    '/pool/evidence-network.js',
    '/pool/research-cycle.js',
    '/ui/pool-home/requester-controls.js',
    '/ui/pool-home/research-panels.js',
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
