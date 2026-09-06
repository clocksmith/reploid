// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { it, expect } from 'vitest';
import { assertPackOperationReceipt } from '../../self/pool/pack-operation.js';
import { assertPackExecutionEvidence, hashDopplerEvidence } from '../../self/pool/executable-pack.js';

const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

it('verifies retained physical assistant outputs and source parity without replaying a GPU', async () => {
  const root = resolve('docs/status/document-assistant-2026-09-06');
  const index = JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8'));
  const compressed = await readFile(resolve(root, index.archive.path));
  expect(hash(compressed)).toBe(index.archive.hash);
  expect(compressed.length).toBe(index.archive.sizeBytes);
  const expanded = gunzipSync(compressed, { maxOutputLength: 96 * 1024 * 1024 });
  expect(expanded.length).toBe(index.archive.expandedBytes);
  const archive = JSON.parse(expanded);
  expect(archive.files).toHaveLength(index.files.length);
  const files = new Map();
  for (const [i, row] of archive.files.entries()) {
    const bytes = Buffer.from(row.base64, 'base64');
    expect(files.has(row.path)).toBe(false);
    expect(row.path).not.toMatch(/private|custody|(^|\/)\.\.(\/|$)/i);
    expect(index.files[i]).toEqual({ path: row.path, hash: hash(bytes), sizeBytes: bytes.length });
    expect(row.hash).toBe(index.files[i].hash);
    files.set(row.path, bytes);
  }
  const json = path => JSON.parse(files.get(path));
  const report = json('document-search/qualification.json');
  const source = json('inputs/generation-source-reference-01.json');
  expect(report.passed).toBe(true);
  expect(report.boundary).toMatchObject({ operatorCount: 1, independentMachines: false,
    independentUsers: false, referencedGeneration: true, sourceTokenComparison: true,
    answerFaithfulnessQualified: false });
  expect(hash(files.get('document-search/runner.js'))).toBe(report.runnerHash);
  expect(hash(files.get('inputs/generation-source-reference-01.json'))).toBe(report.generationReferenceDigest);
  expect(report.adapter).toMatchObject({ vendor: 'amd', isFallbackAdapter: false });
  for (const row of report.servedFiles) expect(hash(files.get(`document-search/runtime${row.path}`))).toBe(row.hash);
  for (const role of ['embedding', 'reranker', 'generator']) {
    const pack = json(`packs/${role}/pack.json`);
    expect(pack.artifacts).toEqual(report.models[role].executablePack.artifacts);
    for (const artifact of pack.artifacts) {
      const retained = index.files.find(row => row.path === `packs/${role}/${artifact.path}`);
      const external = index.externalArtifacts.find(row => row.modelRole === role && row.artifactId === artifact.artifactId);
      expect(retained ?? external).toMatchObject({ hash: artifact.hash, sizeBytes: artifact.sizeBytes });
    }
  }
  expect(report.observations).toHaveLength(24);
  expect(report.raw.generations).toHaveLength(6);
  for (const row of report.observations) {
    const relevant = report.corpus.queries[row.queryIndex].relevance;
    const ids = row.result.matches.map(match => Number(/^document-(\d+)\.txt$/.exec(match.sources[0])[1]));
    expect(relevant[ids[0]]).toBeGreaterThan(0);
    expect(ids.filter(id => relevant[id] > 0)).toHaveLength(Object.values(relevant).filter(grade => grade > 0).length);
    for (const receipt of row.result.receipts) {
      const role = { embed: 'embedding', rerank: 'reranker', generate: 'generator' }[receipt.operation.name];
      await assertPackExecutionEvidence(report.models[role].executablePack, receipt);
      const { receiptDigest, ...payload } = receipt;
      expect(await hashDopplerEvidence(payload)).toBe(receiptDigest);
    }
    if (row.mode === 'answer') {
      const generated = report.raw.generations[row.queryIndex];
      expect(generated.request.input.prompt).toBe(source.outputs[row.queryIndex].prompt);
      expect(generated.output.tokenIds).toEqual(source.outputs[row.queryIndex].generatedTokenIds);
      expect(row.result.answer.text).toBe(source.outputs[row.queryIndex].text);
      await assertPackOperationReceipt(report.models.generator.executablePack, generated.receipt,
        { request: generated.request, output: generated.output, runtimeVersion: report.models.generator.runtimeVersion });
      for (const citation of row.result.answer.citations) {
        const passage = row.result.matches[citation.number - 1];
        expect(citation).toMatchObject({ chunkId: passage.id, documentId: passage.documentId,
          start: passage.start, end: passage.end });
      }
    }
  }
  expect(json('observations/generation-browser-diagnostic-01.json').passed).toBe(false);
  expect(json('observations/generation-browser-diagnostic-05.json').passed).toBe(false);
  const qualified = json('observations/generation-browser-diagnostic-08.json');
  expect(qualified.passed).toBe(true);
  for (const [i, row] of qualified.raw.outputs.entries()) {
    expect(row.promptTokenIds).toEqual(source.outputs[i].promptTokenIds);
    expect(row.result.tokenIds).toEqual(source.outputs[i].generatedTokenIds);
  }
  const installed = json('software/assistant/receipt.json');
  expect(hash(files.get('software/assistant/doppler-gpu-0.6.0.tgz'))).toBe(`sha256:${installed.package.sha256}`);
  expect(installed.package).toEqual(report.installedPackage);
  expect(json('software/assistant/installed-file-verification.json').files).toHaveLength(1756);
  const clean = json('software/clean-build/equivalence.json');
  expect(clean).toMatchObject({ passed: true, cleanStatus: '', byteIdenticalTarballs: true,
    executedPackage: installed.package, cleanPackage: installed.package });
  expect(clean.files).toEqual(json('software/assistant/installed-file-verification.json').files);
  expect(json('observations/document-answer-review-01.json')).toMatchObject({ qualified: false,
    independentReviewer: false, blinded: false, sourceReferenceHash: report.generationReferenceDigest });
}, 30000);
