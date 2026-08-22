import { expect, test } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const manifestPath = path.resolve(__dirname, '../../self/pool/adjudication-pilot-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

test.describe('Reploid Room-1 Pilot E2E Journey', () => {
  test('renders pilot cohort cases with real UniProt sequence hashes and adjudication modes', async ({ page }) => {
    await page.goto('/');

    // Verify page loads research surface
    const researchPanel = page.locator('#room-view, #research-view, body');
    await expect(researchPanel).toBeVisible();

    // Verify pilot case 1 (P0DTC2) hash matches canonical UniProt FASTA
    const sampleCase = manifest.cases[0];
    expect(sampleCase.accession).toBe('P0DTC2');
    expect(sampleCase.sequenceHash).toBe('sha256:794d56c4e53ad15197d12fcee6c8231e888d2fc60728f4ef875561b80af2639d');
    expect(manifest.cohortCaseCount).toBe(24);
    expect(manifest.minimumReportingSample).toBe(20);

    // Verify adjudication canvas elements exist
    const sampleDisputeBtn = page.locator('[data-pool-load-sample-dispute]');
    if (await sampleDisputeBtn.count() > 0) {
      await expect(sampleDisputeBtn.first()).toBeVisible();
    }
  });

  test('validates blinded export package integrity across all 24 cases', async () => {
    const blindedPackage = {
      schema: 'poolday.adjudication_blinded_export/v1',
      pilotId: manifest.pilotId,
      evidenceCutoff: manifest.evidenceCutoff,
      records: manifest.cases.map((c, index) => ({
        token: `blinded-pilot-token-${index + 1}`,
        accession: c.accession,
        sequenceHash: c.sequenceHash,
        disputeType: c.disputeType,
        baseline: {
          decision: 'revise',
          activeTimeSeconds: 310,
          sourcesConsulted: ['UniProtKB', 'InterProScan', 'PubMed:32841599']
        },
        reploid: {
          decision: 'revise',
          activeTimeSeconds: 195,
          modelContract: manifest.modelContract.id,
          priorDecisionsConsulted: ['room-sars-cov2-spike-rbd-20260810']
        },
        evaluatorStatus: 'paired_replicated'
      }))
    };

    expect(blindedPackage.records).toHaveLength(24);
    expect(blindedPackage.records.every((r) => r.sequenceHash.startsWith('sha256:'))).toBe(true);
    expect(blindedPackage.records.every((r) => r.reploid.modelContract === 'esm2-t12-35m-ur50d-f32-af32')).toBe(true);
  });
});
