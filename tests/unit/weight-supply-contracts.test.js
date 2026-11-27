// @vitest-environment node
/**
 * One weight-supply contract, every surface: the same fixtures run through the published library
 * (packages/reploid/src/contracts/weight-supply.js) and the vendored copy the browser host and native hosts import
 * (shared/vendor/reploid/contracts/weight-supply.js), so a stale copy or a restated record fails here. A host that
 * starts reading these records imports the vendored copy and joins this list. Fixtures: tests/fixtures/contracts/weight-supply.json,
 * produced by one in-process private-room run (offer, signed approval, served and consumed transfers, report).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as library from '../../packages/reploid/src/contracts/weight-supply.js';
import * as vendored from '../../shared/vendor/reploid/contracts/weight-supply.js';
import { verifyWeightSupplyApproval } from '../../packages/reploid/src/artifacts/custody/weight-supply.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/contracts/weight-supply.json', import.meta.url), 'utf8'));
const policyFile = JSON.parse(readFileSync(new URL('../../packages/reploid/src/contracts/weight-supply-policy.json', import.meta.url), 'utf8'));
const surfaces = Object.entries({ library, vendored });
const outcome = run => { try { return { value: run() }; } catch (error) { return { error: error.code || error.message }; } };

describe('weight-supply records across surfaces', () => {
  it('every surface exposes the same contract and the same policy file', () => {
    for (const [name, surface] of surfaces) {
      expect(Object.keys(surface).sort(), name).toEqual(Object.keys(library).sort());
      expect(surface.WEIGHT_SUPPLY_OFFER_SCHEMA).toBe('reploid.weight-supply-offer/1');
      expect(surface.WEIGHT_SUPPLY_APPROVAL_SCHEMA).toBe('reploid.weight-supply-approval/1');
      expect(surface.WEIGHT_SUPPLY_REPORT_SCHEMA).toBe('reploid.weight-supply-report/1');
      expect(surface.WEIGHT_TRANSFER_SCHEMA).toBe('reploid.weight-transfer/1');
      expect(surface.WEIGHT_SUPPLY_POLICY, name).toEqual(policyFile);
    }
  });

  it('covers every schema with a valid and an invalid record', () => {
    const schemas = Object.entries(library).filter(([key]) => key.endsWith('_SCHEMA')).map(([, value]) => value);
    for (const schema of schemas) {
      expect(fixture.records.some(row => row.schema === schema && row.valid), schema).toBe(true);
      expect(fixture.records.some(row => row.schema === schema && !row.valid), schema).toBe(true);
    }
  });

  it.each(fixture.records.map(row => [row.name, row]))('%s', (name, row) => {
    for (const [surfaceName, surface] of surfaces) {
      const problems = surface.weightSupplyRecordProblems(row.schema, row.value);
      expect(problems.length === 0, `${surfaceName}: ${problems}`).toBe(row.valid);
      const parsed = outcome(() => surface.parseWeightSupplyRecord(row.value));
      expect(parsed, surfaceName).toEqual(row.valid ? { value: row.value } : { error: 'CONTRACT_INVALID' });
    }
  });

  it('reads a pinned Doppler piece index the same way everywhere', () => {
    for (const [name, surface] of surfaces) {
      expect(JSON.parse(JSON.stringify(surface.pinnedModelPieces(fixture.pinnedModel.input))), name).toEqual(fixture.pinnedModel.expected);
      expect(outcome(() => surface.pinnedModelPieces({ ...fixture.pinnedModel.input,
        modelIdentity: `sha256:${'0'.repeat(64)}` })), name).toEqual({ error: 'CONTRACT_INVALID' });
    }
  });

  it('an approval verifies only as signed by the computer it names', async () => {
    const approval = fixture.records.find(row => row.schema === library.WEIGHT_SUPPLY_APPROVAL_SCHEMA && row.valid).value;
    expect(await verifyWeightSupplyApproval(approval)).toBe(true);
    expect(await verifyWeightSupplyApproval({ ...approval, storageCapBytes: approval.storageCapBytes * 2 })).toBe(false);
    expect(await verifyWeightSupplyApproval({ ...approval, computerId: 'peer:000000000000000000000000' })).toBe(false);
  });

  it('a recommendation without an offer never carries download bytes', () => {
    for (const row of fixture.records.filter(item => item.schema === library.WEIGHT_SUPPLY_RECOMMENDATION_SCHEMA && item.valid)) {
      if (row.value.offer === null) expect(library.NO_OFFER_REASONS).toContain(row.value.noOffer);
      else expect(row.value.offer.totalDownloadBytes).toBe(row.value.offer.pieces.reduce((total, piece) => total + piece.sizeBytes, 0));
    }
  });
});
