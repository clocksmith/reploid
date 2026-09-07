// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readDocumentAnswerCorpus } from '../../scripts/evaluate-document-answers.js';

const directories = [];
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
async function fixture(change = () => {}) {
  const directory = await mkdtemp(join(tmpdir(), 'reploid-answer-corpus-'));
  directories.push(directory);
  const corpus = JSON.parse(await readFile(new URL('../fixtures/document-answer-support-corpus.json', import.meta.url)));
  corpus.id = 'separate-corpus-fixture';
  change(corpus);
  const bytes = JSON.stringify(corpus);
  const corpusPath = join(directory, 'corpus.json');
  await writeFile(corpusPath, bytes);
  return { corpusPath, corpusDigest: digest(bytes) };
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('physical answer evaluation corpus boundary', () => {
  it('keeps the original frozen corpus as the default', async () => {
    const result = await readDocumentAnswerCorpus();
    expect(result.corpus.id).toBe('engineering-evidence-2026-09-07');
    expect(result.corpus.cases).toHaveLength(8);
    expect(result.corpusDigest).toBe(digest(result.bytes));
  });

  it('loads an explicitly pinned separate corpus without claiming it is independently held out', async () => {
    const config = await fixture();
    const result = await readDocumentAnswerCorpus(config);
    expect(result.corpus.id).toBe('separate-corpus-fixture');
    expect(result.corpusPath).toBe(config.corpusPath);
    expect(result.corpusDigest).toBe(config.corpusDigest);
    expect(result).not.toHaveProperty('semanticSupportQualified');
  });

  it('rejects unpinned or changed custom corpus bytes before browser execution', async () => {
    const config = await fixture();
    await expect(readDocumentAnswerCorpus({ corpusPath: config.corpusPath })).rejects.toThrow('frozen corpusDigest');
    await writeFile(config.corpusPath, '{}');
    await expect(readDocumentAnswerCorpus(config)).rejects.toThrow('digest mismatch');
  });

  it('rejects weaker acceptance rules even under a matching byte commitment', async () => {
    const config = await fixture(corpus => { corpus.acceptance.allowUnsupportedFactualClaims = true; });
    await expect(readDocumentAnswerCorpus(config)).rejects.toThrow('acceptance contract');
  });

  it('rejects duplicate case identities and malformed passage identities', async () => {
    const duplicate = await fixture(corpus => { corpus.cases.push(corpus.cases[0]); });
    await expect(readDocumentAnswerCorpus(duplicate)).rejects.toThrow('duplicate corpus case');
    const passage = await fixture(corpus => { corpus.cases[0].passages.push(corpus.cases[0].passages[0]); });
    await expect(readDocumentAnswerCorpus(passage)).rejects.toThrow('duplicate corpus passage');
  });
});
