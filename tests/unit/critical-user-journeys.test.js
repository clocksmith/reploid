import { readFileSync } from 'node:fs';
import path from 'node:path';
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
import {
  JOURNEY_TABLE_END,
  renderJourneyStatusTable,
  replaceJourneyStatusTable
} from '../../scripts/critical-user-journey-contract.js';
import { JOURNEY_DOCS } from '../../scripts/verify-critical-user-journeys.js';

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

  it('rejects an X journey that restates a Zero journey instead of inheriting it', async () => {
    const candidate = clone(xRegistry);
    const zeroJourney = zeroRegistry.journeys.find((journey) => journey.id === 'grow-zero-tool-surface');
    candidate.inheritsJourneyIds = candidate.inheritsJourneyIds.filter((id) => id !== zeroJourney.id);
    candidate.journeys.push({ ...clone(zeroJourney), id: 'grow-x-tool-surface', routes: ['/x'], openWorkIds: [] });

    const errors = await validateXCriticalUserJourneys(candidate, { root: PROJECT_ROOT });
    expect(errors).toContain(
      'journey grow-x-tool-surface restates Zero journey grow-zero-tool-surface; inherit or override it'
    );
    expect(errors).toContain('Zero journey grow-zero-tool-surface is neither inherited nor overridden');
  });

  it('rejects an override that copies the Zero journey it claims to change', async () => {
    const candidate = clone(xRegistry);
    const original = zeroRegistry.journeys.find((journey) => journey.id === 'configure-and-awaken-zero');
    Object.assign(candidate.journeys[0], {
      status: original.status, outcome: original.outcome, honestOutcome: original.honestOutcome
    });

    const errors = await validateXCriticalUserJourneys(candidate, { root: PROJECT_ROOT });
    expect(errors).toContain(
      'journey configure-and-awaken-x restates configure-and-awaken-zero without a different status or outcome'
    );
  });

  it('keeps both Markdown status tables generated from the registries', () => {
    const zeroDoc = readFileSync(path.join(PROJECT_ROOT, JOURNEY_DOCS.zero), 'utf8');
    const xDoc = readFileSync(path.join(PROJECT_ROOT, JOURNEY_DOCS.x), 'utf8');
    expect(replaceJourneyStatusTable(zeroDoc, renderJourneyStatusTable(zeroRegistry))).toBe(zeroDoc);
    expect(replaceJourneyStatusTable(xDoc, renderJourneyStatusTable(xRegistry, {
      base: zeroRegistry, baseDoc: '../zero/critical-user-journeys.md'
    }))).toBe(xDoc);

    const stale = clone(zeroRegistry);
    stale.journeys[0].status = 'supported';
    expect(replaceJourneyStatusTable(zeroDoc, renderJourneyStatusTable(stale))).not.toBe(zeroDoc);
    expect(replaceJourneyStatusTable(zeroDoc.replace(JOURNEY_TABLE_END, ''), '')).toBeNull();
  });
});
