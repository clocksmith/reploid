import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getPoolModelContract } from '../../self/pool/model-contract.js';
import { validateDopplerBrowserProteinObservation } from '../../self/pool/doppler-browser-observation.js';

const observation = JSON.parse(await readFile(
  resolve('docs/status/esm2-35m-browser-protein-observation-2026-08-02.json'),
  'utf8'
));
const model = getPoolModelContract('esm2-t12-35m-ur50d-f32-af32');

describe('Poolday persisted Doppler protein browser observation', () => {
  it('retains real ESM-2 browser evidence without treating it as promotable', () => {
    expect(validateDopplerBrowserProteinObservation(observation, { model })).toMatchObject({
      ok: true,
      promotable: false,
    });
  });

  it('rejects a partial observation that tries to become promotion eligible', () => {
    expect(validateDopplerBrowserProteinObservation({
      ...observation,
      status: 'qualified',
      promotion: { eligible: true },
    }, { model })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'browser observation must remain incomplete until the full qualification record exists',
        'browser observation must not be promotion eligible',
      ]),
    });
  });

  it('does not confuse an incomplete qualification set with dirty source', () => {
    expect(validateDopplerBrowserProteinObservation({
      ...observation,
      release: {
        ...observation.release,
        sourceDirty: true,
        sourceStateHash: 'sha256:ab385475d1a8732696a92d6087650a525157177724cf2074330103efec78d5fd',
      },
    }, { model })).toMatchObject({
      ok: true,
      promotable: false,
    });
  });

  it('rejects evidence without exact producer, fixture, and artifact-source identities', () => {
    expect(validateDopplerBrowserProteinObservation({
      ...observation,
      fixture: {
        ...observation.fixture,
        referenceHash: null,
      },
      release: {
        ...observation.release,
        browserModuleDigestScope: ['src/inference/browser-harness.js'],
        qualificationArtifactSource: null,
      },
    }, { model })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'browser observation browser module digest scope is incomplete',
        'browser observation must identify the pinned non-Poolday qualification artifact source',
        'browser observation fixture reference is not bound to the exact Doppler source',
      ]),
    });
  });
});
