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
});
