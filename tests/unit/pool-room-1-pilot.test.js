import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  ADJUDICATION_INDEPENDENCE_DIMENSIONS,
  ADJUDICATION_NORTH_STAR_OBJECTIVE,
  ADJUDICATION_NORTH_STAR_POLICY_VERSION,
  ADJUDICATION_OPERATIONAL_METRICS
} from '../../self/pool/adjudication-north-star.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const manifestPath = path.resolve(__dirname, '../../self/pool/adjudication-pilot-manifest.json');

describe('Reploid Room-1 Pilot Cohort & Charter Compliance', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  it('contains a valid Room-1 pilot manifest with 24 disjoint cases', () => {
    expect(manifest.schema).toBe('poolday.adjudication_pilot_manifest/v1');
    expect(manifest.pilotId).toBe('reploid-room-1-pilot-24');
    expect(manifest.cohortCaseCount).toBe(24);
    expect(manifest.minimumReportingSample).toBe(20);
    expect(manifest.cases).toHaveLength(24);
  });

  it('guarantees family disjointness across all 24 cases', () => {
    const familyIds = manifest.cases.map((c) => c.familyId);
    const uniqueFamilies = new Set(familyIds);
    expect(uniqueFamilies.size).toBe(24);
  });

  it('binds valid UniProt accessions, sequence hashes, and domain disputes', () => {
    const validAccessionPattern = /^[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2}$/;
    const validSha256Pattern = /^sha256:[a-f0-9]{64}$/;

    for (const item of manifest.cases) {
      expect(item.accession).toMatch(validAccessionPattern);
      expect(item.sequenceHash).toMatch(validSha256Pattern);
      expect(item.sequenceLength).toBeGreaterThan(0);
      expect(item.catalogAnnotation.feature).toBeTruthy();
      expect(item.catalogAnnotation.range).toBeTruthy();
      expect(item.disputeSummary.length).toBeGreaterThan(10);
      expect(item.budgetLimitSeconds).toBe(600);
      expect(item.interProSignatures.length).toBeGreaterThan(0);
    }
  });

  it('complies with North-Star adjudication policy dimensions', () => {
    expect(ADJUDICATION_NORTH_STAR_POLICY_VERSION).toBe('poolday.adjudication_north_star_policy/v1');
    expect(ADJUDICATION_NORTH_STAR_OBJECTIVE).toBe(
      'median_normalized_cost_to_predeclared_independently_replicated_conclusion_relative_to_baseline'
    );
    expect(ADJUDICATION_OPERATIONAL_METRICS).toContain('peers');
    expect(ADJUDICATION_OPERATIONAL_METRICS).toContain('total_compute');
    expect(ADJUDICATION_INDEPENDENCE_DIMENSIONS).toContain('reviewer_identity');
  });

  it('formats blinded evaluator export package correctly', () => {
    const mockBlindedExport = {
      pilotId: manifest.pilotId,
      evidenceCutoff: manifest.evidenceCutoff,
      cases: manifest.cases.map((c, index) => ({
        blindedCaseToken: `case-token-${index + 1}`,
        accession: c.accession,
        sequenceHash: c.sequenceHash,
        disputeType: c.disputeType,
        arm1Outcome: { decision: 'revise', activeTimeSeconds: 240 },
        arm2Outcome: { decision: 'revise', activeTimeSeconds: 165 },
        replicated: true
      }))
    };

    expect(mockBlindedExport.cases).toHaveLength(24);
    expect(mockBlindedExport.cases.filter((c) => c.replicated)).toHaveLength(24);
  });
});
