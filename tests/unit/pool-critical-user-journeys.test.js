import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  JOURNEY_REGISTRY_PATH,
  PROJECT_ROOT,
  validatePoolCriticalUserJourneys
} from '../../scripts/verify-pool-critical-user-journeys.js';

const registry = JSON.parse(readFileSync(JOURNEY_REGISTRY_PATH, 'utf8'));
const poolConfig = JSON.parse(readFileSync('self/pool/pool-config.json', 'utf8'));
const clone = (value) => structuredClone(value);

describe('Poolday critical user journey registry', () => {
  it('connects every journey to current implementation, tests, policy, and remaining work', async () => {
    await expect(validatePoolCriticalUserJourneys(registry, {
      root: PROJECT_ROOT,
      poolConfig
    })).resolves.toEqual([]);
  });

  it('rejects journey work that is not linked in both directions', async () => {
    const candidate = clone(registry);
    candidate.journeys[0].openWorkIds = candidate.journeys[0].openWorkIds.filter(
      (id) => id !== 'measure-provider-availability'
    );
    const errors = await validatePoolCriticalUserJourneys(candidate, {
      root: PROJECT_ROOT,
      poolConfig
    });
    expect(errors).toContain(
      'openWork measure-provider-availability is not linked back from journey request-text-answer'
    );
  });

  it('rejects a journey model that its selected policy does not allow', async () => {
    const candidateConfig = clone(poolConfig);
    candidateConfig.policies.fastest_receipt.allowedModels = (
      candidateConfig.policies.fastest_receipt.allowedModels.filter(
        (modelId) => modelId !== 'esm2-t12-35m-ur50d-f32-af32'
      )
    );
    const errors = await validatePoolCriticalUserJourneys(registry, {
      root: PROJECT_ROOT,
      poolConfig: candidateConfig
    });
    expect(errors).toContain(
      'journeys[5] model esm2-t12-35m-ur50d-f32-af32 is not allowed by policy fastest_receipt'
    );
  });
});
