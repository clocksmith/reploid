// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { assertPackExecutionEvidence, hashDopplerEvidence } from '../../self/pool/executable-pack.js';

const root = resolve('docs/status/document-search-2026-09-06');
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

describe('retained real document search (offline artifact validation, no GPU replay)', () => {
  it('binds source comparison, exact runtime, failed attempts, and bounded retrieval observations', async () => {
    const index = JSON.parse(await readFile(resolve(root, 'index.json'), 'utf8'));
    const compressed = await readFile(resolve(root, index.archive.path));
    expect(hash(compressed)).toBe(index.archive.hash);
    expect(compressed.length).toBe(index.archive.sizeBytes);
    const expanded = gunzipSync(compressed, { maxOutputLength: 96 * 1024 * 1024 });
    expect(expanded.length).toBe(index.archive.expandedBytes);
    const archive = JSON.parse(expanded);
    const files = new Map();
    expect(archive.files).toHaveLength(index.files.length);
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
    expect(report.passed).toBe(true);
    expect(report.boundary).toMatchObject({ operatorCount: 1, independentMachines: false,
      independentUsers: false, referencedGeneration: false, sourceNumericalComparison: false });
    expect(report.adapter).toMatchObject({ vendor: 'amd', isFallbackAdapter: false });
    expect(hash(files.get('document-search/runner.js'))).toBe(report.runnerHash);
    expect(hash(files.get('inputs/corpus.json'))).toBe(report.corpusDigest);
    for (const source of report.servedFiles) {
      expect(hash(files.get(`document-search/runtime${source.path}`)), source.path).toBe(source.hash);
    }
    for (const role of ['embedding', 'reranker']) {
      const pack = json(`packs/${role}/pack.json`);
      expect(pack.artifacts).toEqual(report.models[role].executablePack.artifacts);
      for (const artifact of pack.artifacts) {
        const retained = index.files.find(row => row.path === `packs/${role}/${artifact.path}`);
        const external = index.externalArtifacts.find(row => row.modelRole === role && row.artifactId === artifact.artifactId);
        expect(retained ?? external, artifact.artifactId).toMatchObject({ hash: artifact.hash, sizeBytes: artifact.sizeBytes });
      }
    }
    expect(report.observations).toHaveLength(18);
    expect(report.modelOpenings).toHaveLength(2);
    for (const row of report.observations) {
      const relevant = report.corpus.queries[row.queryIndex].relevance;
      const ids = row.result.matches.map(match => Number(/^document-(\d+)\.txt$/.exec(match.sources[0])[1]));
      expect(relevant[ids[0]]).toBeGreaterThan(0);
      expect(ids.filter(id => relevant[id] > 0)).toHaveLength(Object.values(relevant).filter(grade => grade > 0).length);
      for (const receipt of row.result.receipts) {
        const role = receipt.operation.name === 'embed' ? 'embedding' : 'reranker';
        await assertPackExecutionEvidence(report.models[role].executablePack, receipt);
        const { receiptDigest, ...payload } = receipt;
        expect(await hashDopplerEvidence(payload)).toBe(receiptDigest);
      }
      if (row.mode !== 'embedding') {
        expect(row.result.embeddingCache).toEqual({ corpus: true, query: true });
        expect(row.result.receipts[0]).toEqual(report.observations[row.queryIndex].result.receipts[0]);
      }
    }
    const reference = json('inputs/qwen-embedding-source-reference.json');
    const qualified = json('observations/qwen-embedding-f16-pack-browser-01.json');
    expect(await hashDopplerEvidence(reference)).toBe(qualified.referenceDigest);
    expect(qualified.boundary).toMatchObject({ sourceComparison: true, signedPackExecution: true });
    expect(qualified.raw.receipts).toHaveLength(36);
    expect(reference.tolerances).toEqual({ embeddingMaxAbs: 0.02, tokenIds: 'exact' });
    for (const [i, output] of qualified.raw.outputs.entries()) {
      const expected = reference.outputs[i];
      expect(output.tokenIds).toEqual(expected.tokenIds);
      expect(output.embedding).toHaveLength(1024);
      const error = Math.max(...output.embedding.map((value, j) => Math.abs(value - expected.embedding[j])));
      expect(error).toBeLessThanOrEqual(reference.tolerances.embeddingMaxAbs);
    }
    expect(json('observations/qwen-embedding-browser-01.json').passed).toBe(false);
    expect(json('observations/reploid-document-search-01.json').passed).toBe(false);
    expect(json('observations/reploid-document-search-02.json').passed).toBe(false);
    for (const name of ['final-embedding', 'document']) {
      const receipt = json(`software/${name}/receipt.json`);
      expect(receipt.passed).toBe(true);
      expect(hash(files.get(`software/${name}/doppler-gpu-0.5.2.tgz`))).toBe(`sha256:${receipt.package.sha256}`);
      expect(json(`software/${name}/installed-file-verification.json`).files).toHaveLength(1756);
    }
  }, 30000);
});
