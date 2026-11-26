// Runs Reploid's Doppler boundary against the real dopplerx package instead of mocks.
// The values come from the installed package on CPU (no WebGPU device is opened):
// - the sequence alphabet Doppler reports for a pinned ESM-2 RDRR manifest (parseManifest),
// - the qualification abort mode Doppler records for a sequence request (normalizeToolingCommandRequest),
// - the failure class and receipt of a provider failure (createDopplerProvider, failing handle).
// Reploid must map each to its own vocabulary for 0.1.x (snake_case) and 0.2.x (kebab-case).
// A source guard fails if Reploid compares against a Doppler legacy spelling outside the
// reviewed list below, so a comparison against a value Doppler no longer emits cannot land.
//
// By default the test uses Reploid's installed dopplerx (the pinned version). To test other
// builds, install each by path in its own directory and pass them, separated by ':':
//   DOPPLERX_BOUNDARY_PACKAGES=/tmp/a:/tmp/b npx vitest run tests/unit/doppler-boundary-real-package.test.js
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SEQUENCE_ALPHABETS, sequenceAlphabetFromDoppler } from '../../shared/pool/sequence-workload.js';
import { reduceDopplerSequenceResult } from '../../apps/poolday/pool/sequence-result.js';
import { validateDopplerBrowserProteinObservation } from '../../apps/poolday/pool/doppler-browser-observation.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const fixture = (name) => path.join(ROOT, 'tests/fixtures', name);
const spellings = JSON.parse(readFileSync(fixture('dopplerx-legacy-spellings.json'), 'utf8')).aliases;
const esm2ManifestText = readFileSync(fixture('esm2-35m-rdrr-manifest.json'), 'utf8');
const observation = JSON.parse(readFileSync(
  path.join(ROOT, 'docs/status/esm2-35m-browser-protein-observation-2026-08-02.json'), 'utf8'
));
const model = JSON.parse(readFileSync(fixture('legacy-esm2-model.json'), 'utf8')).model;

const packageRoots = (process.env.DOPPLERX_BOUNDARY_PACKAGES
  ? process.env.DOPPLERX_BOUNDARY_PACKAGES.split(':').filter(Boolean).map((dir) => path.resolve(dir, 'node_modules/dopplerx'))
  : [path.join(ROOT, 'node_modules/dopplerx')]);

function entryFile(entry) {
  if (typeof entry === 'string') return entry;
  return entryFile(entry.node ?? entry.import ?? entry.default);
}

async function openDoppler(root) {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const load = (subpath) => import(pathToFileURL(path.join(root, entryFile(pkg.exports[subpath]))).href);
  return { pkg, load };
}

// Reploid's own values that share a spelling with a Doppler legacy value, and Doppler values
// Reploid maps at the boundary. A new comparison against any other legacy spelling fails.
const REVIEWED_LEGACY_SPELLINGS = Object.freeze({
  amino_acid: 'Poolday sequence alphabet; Doppler spellings mapped by sequenceAlphabetFromDoppler',
  after_start: 'mapped in doppler-browser-observation.js (isAfterStartAbort)',
  peft_adapter: 'mapped in neural-compiler.js (fromDopplerSpelling)',
  tinker_peft_browser_adapter: 'mapped in neural-compiler.js (fromDopplerSpelling)',
  peft_safetensors: "Reploid's adapter format, sent to Doppler as input (read throughout 0.x)",
  on_failure: 'runtime config input sent to Doppler (read throughout 0.x)',
  rate_limited: 'Reploid HTTP and room policy reason, not a Doppler value',
  not_cached: 'Reploid model-cache integrity status, not a Doppler value',
  peer_unavailable: 'Reploid room signaling reason, not a Doppler value',
  empty_response: 'Reploid GEPA optimizer reason, not a Doppler value',
  no_data: 'Reploid prompt-memory reason, not a Doppler value',
  every_n: 'Reploid HITL cadence, not a Doppler value',
});

describe('Doppler legacy spelling guard (Reploid source)', () => {
  it('compares against no Doppler legacy spelling outside the reviewed list', () => {
    const files = execFileSync('git', ['ls-files', 'apps', 'packages', 'server', 'shared', 'self', 'scripts'], { cwd: ROOT })
      .toString().split('\n')
      .filter((file) => /\.(js|ts)$/.test(file) && !/\/vendor\/|\.bundle\.js$|\/dist\/|\.d\.ts$/.test(file));
    const found = new Map();
    for (const file of files) {
      const text = readFileSync(path.join(ROOT, file), 'utf8');
      for (const match of text.matchAll(/['"`]([a-z][a-z0-9]*(?:_[a-z0-9]+)+)['"`]/g)) {
        if (Object.hasOwn(spellings, match[1]) && !Object.hasOwn(REVIEWED_LEGACY_SPELLINGS, match[1])) {
          found.set(match[1], [...(found.get(match[1]) ?? []), file]);
        }
      }
    }
    expect(Object.fromEntries(found)).toEqual({});
  });
});

for (const root of packageRoots) {
  describe(`Reploid Doppler boundary on ${path.relative(ROOT, root) || root}`, () => {
    it('is a real dopplerx install', async () => {
      expect(existsSync(path.join(root, 'package.json'))).toBe(true);
      const { pkg } = await openDoppler(root);
      expect(pkg.name).toBe('dopplerx');
      const table = path.join(root, 'src/config/legacy-enum-values.js');
      if (existsSync(table)) {
        // 0.2.0 and later ship the alias table: the snapshot Reploid guards with must match it.
        const { LEGACY_ENUM_VALUE_ALIASES } = await import(pathToFileURL(table).href);
        expect(Object.fromEntries(Object.entries(LEGACY_ENUM_VALUE_ALIASES).sort(([a], [b]) => (a < b ? -1 : 1))))
          .toEqual(spellings);
      }
    });

    it('maps the sequence alphabet Doppler reports for a pinned ESM-2 manifest', async () => {
      const { pkg, load } = await openDoppler(root);
      const { parseManifest } = await load('./tooling/manifest');
      const alphabet = parseManifest(esm2ManifestText).inference.sequence.alphabet;
      expect(alphabet).toBe(pkg.version.startsWith('0.1.') ? 'amino_acid' : 'amino-acid');
      expect(sequenceAlphabetFromDoppler(alphabet)).toBe(SEQUENCE_ALPHABETS.aminoAcid);
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
      const reduced = await reduceDopplerSequenceResult({
        alphabet,
        tokens: [0, 1, 2, 3],
        includedTokenCount: 4,
        pooledEmbedding: [0.25, -0.5, 0.75],
        tokenEmbeddings: Array(12).fill(0.125),
        logits: [0, 0.1, 0.2, 0.3, 1, 1.1, 1.2, 1.3, 2, 2.1, 2.2, 2.3, 3, 3.1, 3.2, 3.3],
        embeddingDim: 3,
        vocabSize: 4
      }, request);
      expect(reduced.sequenceResult.alphabet).toBe(SEQUENCE_ALPHABETS.aminoAcid);
    });

    it('accepts a browser observation recorded with the abort mode and alphabet Doppler emits', async () => {
      const { load } = await openDoppler(root);
      const { normalizeToolingCommandRequest } = await load('./tooling');
      const { parseManifest } = await load('./tooling/manifest');
      // Reploid's 0.1.x request spellings; 0.2.0 reads them and records kebab-case.
      const recorded = normalizeToolingCommandRequest({
        command: 'verify',
        workload: 'inference',
        modelId: 'esm2-t12-35m-ur50d-f32-af32',
        inferenceInput: {
          sequence: 'MKTIIALSYIFCLVFADYKDDDDK',
          sequenceAlphabet: 'amino_acid',
          includeTokenEmbeddings: true,
          includeLogits: false,
          sequenceQualificationAbort: 'after_start',
          sequenceQualificationStaleAfterStart: true
        }
      }).inferenceInput;
      const alphabet = parseManifest(esm2ManifestText).inference.sequence.alphabet;
      const current = {
        ...observation,
        fixture: { ...observation.fixture, sequenceAlphabet: alphabet },
        runs: {
          ...observation.runs,
          cancellation: { ...observation.runs.cancellation, mode: recorded.sequenceQualificationAbort },
          staleResultRejection: { ...observation.runs.staleResultRejection, mode: recorded.sequenceQualificationAbort }
        }
      };
      const baseline = validateDopplerBrowserProteinObservation(observation, { model });
      expect(baseline.ok).toBe(true);
      expect(validateDopplerBrowserProteinObservation(current, { model })).toEqual(baseline);
      // Aborts other than after-start stay rejected in either spelling.
      const before = normalizeToolingCommandRequest({
        command: 'verify',
        workload: 'inference',
        modelId: 'esm2-t12-35m-ur50d-f32-af32',
        inferenceInput: { sequence: 'MKTIIALSYIFCLVFADYKDDDDK', sequenceQualificationAbort: 'before_execution' }
      }).inferenceInput.sequenceQualificationAbort;
      const wrong = { ...current, runs: { ...current.runs, cancellation: { ...current.runs.cancellation, mode: before } } };
      expect(validateDopplerBrowserProteinObservation(wrong, { model }).ok).toBe(false);
    });

    it('reads the failure class and receipt of a real provider failure in a spelling it knows', async () => {
      const { pkg, load } = await openDoppler(root);
      const { createDopplerProvider } = await load('./provider');
      const failing = {
        loaded: true,
        modelId: 'cpu-boundary-probe',
        manifest: null,
        deviceInfo: null,
        async generateText() { throw new Error('WebGPU out of memory during prefill'); },
        async unload() {}
      };
      const provider = createDopplerProvider({
        local: { handle: failing },
        policy: { mode: 'prefer-local', fallbackOn: ['gpu_oom'] },
        fallback: { provider: 'openai', model: 'gpt-4o', baseUrl: 'http://127.0.0.1:9' },
        diagnostics: { receipts: true }
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
      try {
        const result = await provider.generate('hello');
        const failureClass = result.receipt.failure.failureClass;
        expect(failureClass).toBe(pkg.version.startsWith('0.1.') ? 'gpu_oom' : 'gpu-oom');
        // Every Doppler spelling this boundary can see is in the snapshot, in one form or the other.
        const known = new Set([...Object.keys(spellings), ...Object.values(spellings)]);
        expect(known.has(failureClass)).toBe(true);
        expect(known.has(result.receipt.fallbackDecision.reason)).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
}
