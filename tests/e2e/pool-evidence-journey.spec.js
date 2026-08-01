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
    const curator = await createIdentity('reviewer', 'e2e-curator');
    const independent = await createIdentity('reviewer', 'e2e-independent');
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
    for (const record of [firstSubmission, secondSubmission, firstResult, secondResult, annotation, review]) {
      await store.appendResearchRecord(record);
    }
  });

  await page.goto('/records');
  await expect(page.locator('[data-pool-research-workspace]')).toBeVisible();
  await expect(page.locator('.pool-research-stats dd').nth(0)).toHaveText('2');
  await expect(page.locator('.pool-research-stats dd').nth(1)).toHaveText('2');
  await expect(page.locator('.pool-research-stats dd').nth(2)).toHaveText('2');
  await expect(page.locator('.pool-research-stats dd').nth(3)).not.toHaveText('0');
  await expect(page.getByText('accepted annotations', { exact: false })).toBeVisible();
  await expect(page.getByText('deterministic similarity clusters', { exact: false })).toBeVisible();

  await page.locator('[data-research-search]').fill('hydrophobic');
  await expect(page.locator('.pool-research-record b').filter({ hasText: 'Reviewed hydrophobic N-terminus evidence.' })).toBeVisible();
  await expect(page.locator('.pool-research-record')).toHaveCount(1);

  const approve = page.locator('[data-research-approve-task]').first();
  await expect(approve).toBeVisible();
  await approve.click();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});
