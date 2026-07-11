import { describe, expect, it } from 'vitest';

import {
  validateSurfaceClaimIndex,
  verifySurfaceClaimIndex
} from '../../scripts/verify-surface-claim-index.js';

describe('surface claim index', () => {
  it('binds every public status row to repository evidence', async () => {
    const { index, errors } = await verifySurfaceClaimIndex();

    expect(errors).toEqual([]);
    expect(index.entries.map((entry) => entry.surface)).toEqual(expect.arrayContaining([
      '/',
      '/zero',
      '/x',
      'peer-slot-placement',
      'browser-provider-roles',
      'signaling',
      'public-mesh'
    ]));
  });

  it('denies claims for blocked rows', async () => {
    const errors = await validateSurfaceClaimIndex({
      schema: 'reploid/surface-claim-index/v1',
      entries: [{
        surface: 'future-surface',
        status: 'blocked',
        evidencePaths: ['README.md'],
        blockers: [],
        claimPermission: true
      }]
    });

    expect(errors).toContain('entries[0] is blocked and cannot grant claimPermission');
    expect(errors).toContain('entries[0] is blocked and must name a blocker');
  });
});
