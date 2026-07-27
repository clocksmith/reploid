import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  JOURNEY_REGISTRY_PATH as ZERO_JOURNEY_REGISTRY_PATH,
  PROJECT_ROOT,
  validateZeroCriticalUserJourneys
} from '../../scripts/verify-zero-critical-user-journeys.js';
import {
  JOURNEY_REGISTRY_PATH as X_JOURNEY_REGISTRY_PATH,
  validateXCriticalUserJourneys
} from '../../scripts/verify-x-critical-user-journeys.js';

const zeroRegistry = JSON.parse(readFileSync(ZERO_JOURNEY_REGISTRY_PATH, 'utf8'));
const xRegistry = JSON.parse(readFileSync(X_JOURNEY_REGISTRY_PATH, 'utf8'));
const clone = (value) => structuredClone(value);

describe('Zero and X critical user journey registries', () => {
  it('connects every current journey to implementation, tests, limitations, and work', async () => {
    await expect(validateZeroCriticalUserJourneys(zeroRegistry, {
      root: PROJECT_ROOT
    })).resolves.toEqual([]);
    await expect(validateXCriticalUserJourneys(xRegistry, {
      root: PROJECT_ROOT
    })).resolves.toEqual([]);
  });

  it('keeps Zero and X route ownership separate', () => {
    expect(new Set(zeroRegistry.journeys.flatMap((journey) => journey.routes))).toEqual(
      new Set(['/zero'])
    );
    expect(new Set(xRegistry.journeys.flatMap((journey) => journey.routes))).toEqual(
      new Set(['/x'])
    );
  });

  it('rejects one-way remaining-work links', async () => {
    const candidate = clone(xRegistry);
    candidate.journeys[0].openWorkIds = candidate.journeys[0].openWorkIds.filter(
      (id) => id !== 'prove-x-inference-preflight'
    );

    const errors = await validateXCriticalUserJourneys(candidate, {
      root: PROJECT_ROOT
    });
    expect(errors).toContain(
      'openWork prove-x-inference-preflight is not linked back from journey configure-and-awaken-x'
    );
  });

  it('rejects narrative evidence paths that do not exist', async () => {
    const candidate = clone(zeroRegistry);
    candidate.journeys[0].testPaths.push('tests/e2e/not-a-real-zero-proof.spec.js');

    const errors = await validateZeroCriticalUserJourneys(candidate, {
      root: PROJECT_ROOT
    });
    expect(errors).toContain(
      'journeys[0] is missing: tests/e2e/not-a-real-zero-proof.spec.js'
    );
  });
});
