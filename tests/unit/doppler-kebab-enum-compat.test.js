// DopplerX 0.2.0 spells its enum values in kebab-case (amino-acid, after-start);
// 0.1.x used snake_case. Poolday reads both at the Doppler boundary and keeps
// its own vocabulary (amino_acid) for requests, receipts and signed records.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SEQUENCE_ALPHABETS, sequenceAlphabetFromDoppler } from '../../shared/pool/sequence-workload.js';
import { reduceDopplerSequenceResult } from '../../apps/poolday/pool/sequence-result.js';
import { validateDopplerBrowserProteinObservation } from '../../apps/poolday/pool/doppler-browser-observation.js';

const observation = JSON.parse(await readFile(
  resolve('docs/status/esm2-35m-browser-protein-observation-2026-08-02.json'),
  'utf8'
));
const model = JSON.parse(await readFile(resolve('tests/fixtures/legacy-esm2-model.json'), 'utf8')).model;

const request = {
  workload: 'sequence.masked_logits.v1',
  alphabet: SEQUENCE_ALPHABETS.aminoAcid,
  sequenceHash: 'a'.repeat(64),
  sequenceLength: 4,
  includeTokenEmbeddings: true,
  coordinateSystem: 'zero_based_sequence_index',
  sequenceIndices: [1],
  tokenIndices: [1],
  topK: 2
};
const dopplerResult = (alphabet) => ({
  alphabet,
  tokens: [0, 1, 2, 3],
  includedTokenCount: 4,
  pooledEmbedding: [0.25, -0.5, 0.75],
  tokenEmbeddings: Array(12).fill(0.125),
  logits: [0, 0.1, 0.2, 0.3, 1, 1.1, 1.2, 1.3, 2, 2.1, 2.2, 2.3, 3, 3.1, 3.2, 3.3],
  embeddingDim: 3,
  vocabSize: 4
});

describe('Doppler sequence alphabet spellings', () => {
  it('maps both DopplerX spellings to the Poolday alphabet and leaves others alone', () => {
    expect(sequenceAlphabetFromDoppler('amino-acid')).toBe('amino_acid');
    expect(sequenceAlphabetFromDoppler('amino_acid')).toBe('amino_acid');
    expect(sequenceAlphabetFromDoppler('nucleotide')).toBe('nucleotide');
    expect(sequenceAlphabetFromDoppler('rna')).toBe('rna');
    expect(sequenceAlphabetFromDoppler('toString')).toBe('toString');
  });

  it('reduces a 0.2.0 result exactly as the same 0.1.x result', async () => {
    const legacy = await reduceDopplerSequenceResult(dopplerResult('amino_acid'), request);
    const current = await reduceDopplerSequenceResult(dopplerResult('amino-acid'), request);
    expect(current).toEqual(legacy);
    expect(current.sequenceResult.alphabet).toBe('amino_acid');
  });

  it('still rejects a result for another alphabet', async () => {
    await expect(reduceDopplerSequenceResult(dopplerResult('nucleotide'), request))
      .rejects.toThrow(/alphabet nucleotide does not match amino_acid/);
  });
});

describe('Doppler browser observation abort spellings', () => {
  it('accepts an observation recorded with the 0.2.0 kebab-case values', () => {
    const current = {
      ...observation,
      fixture: { ...observation.fixture, sequenceAlphabet: 'amino-acid' },
      runs: {
        ...observation.runs,
        cancellation: { ...observation.runs.cancellation, mode: 'after-start' },
        staleResultRejection: { ...observation.runs.staleResultRejection, mode: 'after-start' }
      }
    };
    expect(validateDopplerBrowserProteinObservation(current, { model }))
      .toEqual(validateDopplerBrowserProteinObservation(observation, { model }));
  });

  it('still rejects an abort that is not after start', () => {
    const wrong = { ...observation, runs: { ...observation.runs, cancellation: { ...observation.runs.cancellation, mode: 'before-execution' } } };
    expect(validateDopplerBrowserProteinObservation(wrong, { model })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'browser observation cancellation evidence does not prove an after-start abort without a published result'
      ])
    });
  });
});
