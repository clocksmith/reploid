// REP-8 retrieval and citation contracts over the deterministic fixed-document provider. No search provider,
// network request or key is involved; the lexical checker is a test double, not qualified support checking.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFixedSearchProvider, createLexicalSupportChecker, createRetrieval, normalizeRetrievalLimits, parseCitations,
  renderSourceContext, verifyCitations } from '../../packages/reploid/src/retrieval/index.js';

const RETRIEVED_AT = 1760000000000;
const sha = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const DOCUMENTS = [
  { id: 'fixed:eiffel', url: 'https://fixed.example/eiffel', title: 'Eiffel Tower',
    text: 'The Eiffel Tower in Paris was completed in 1889.\n\nThe tower is 330 metres tall including its antennas.' },
  { id: 'fixed:louvre', url: 'https://fixed.example/louvre', title: 'Louvre Museum',
    text: 'The Louvre in Paris is the most visited art museum in the world.' },
  { id: 'fixed:seine', url: 'https://fixed.example/seine', title: 'Seine', text: 'The Seine flows through Paris to the English Channel.' }
];
const fixed = (documents = DOCUMENTS) => createFixedSearchProvider({ documents, now: () => RETRIEVED_AT });
const retrieval = ({ provider = fixed(), extractor = provider, supportChecker = createLexicalSupportChecker(), ...rest } = {}) =>
  createRetrieval({ provider, extractor: extractor?.extract ? extractor : null, supportChecker, ...rest });
const run = async (port, query, limits) => port.retrieve(port.pending(port.request({ limits }, query), 1), null);
const result = (n, text = `Passage ${n} about Paris.`) => ({ sourceId: `fake:${n}`, url: `https://fake.example/${n}`, title: `Source ${n}`,
  excerpt: text, retrievedAt: RETRIEVED_AT, contentHash: sha(text) });
const provider = search => ({ id: 'test.provider', version: '1', search });

describe('retrieval', () => {
  it('builds a bounded, numbered source context and keeps each source\'s provenance', async () => {
    const port = retrieval(), record = await run(port, 'Eiffel Tower Paris completed');
    expect(record).toMatchObject({ schema: 'reploid.retrieval-record/v1', outcome: 'retrieved', error: null, sourceUse: 'requester-opt-in',
      provider: { id: 'reploid.fixed-documents', version: '1' }, extractor: { id: 'reploid.fixed-documents', version: '1' } });
    expect(record.sources.map(source => [source.number, source.sourceId])).toEqual([[1, 'fixed:eiffel'], [2, 'fixed:louvre'], [3, 'fixed:seine']]);
    for (const source of record.sources) {
      const document = DOCUMENTS.find(item => item.id === source.sourceId);
      expect(source).toMatchObject({ url: document.url, title: document.title, retrievedAt: RETRIEVED_AT, contentHash: sha(document.text),
        passageOrigin: 'extract', truncated: false, passageHash: sha(source.passage) });
      expect(document.text).toContain(source.passage);
    }
    const context = renderSourceContext(record.sources);
    expect(record.context).toEqual({ schema: 'reploid.retrieval-context/v1', characters: context.length, digest: sha(context) });
    expect(context.length).toBeLessThanOrEqual(record.limits.maxContextCharacters);
    expect(context).toContain('[1] Eiffel Tower\nhttps://fixed.example/eiffel\nThe Eiffel Tower in Paris was completed in 1889.');

    const sent = await port.dispatch({ model: { id: 'm' }, retrieval: { query: 'q' },
      messages: [{ role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Reply' }, { role: 'user', content: 'When was it built?' }] }, record);
    expect(sent).not.toHaveProperty('retrieval');
    expect(sent.messages.slice(0, 2)).toEqual([{ role: 'user', content: 'Earlier' }, { role: 'assistant', content: 'Reply' }]);
    expect(sent.messages[2].content).toBe(`${context}\n\nSearch query: Eiffel Tower Paris completed\nQuestion: When was it built?`);
    // A record whose sources no longer match their digest cannot be dispatched.
    const altered = structuredClone(record); altered.sources[0].passage += ' Altered.';
    await expect(port.dispatch({ messages: [{ role: 'user', content: 'q' }] }, altered)).rejects.toThrow('does not match its recorded digest');
  });

  it('enforces result count, character and time limits; requests cannot exceed the policy', async () => {
    const many = provider(async () => Array.from({ length: 8 }, (_, index) => result(index + 1)));
    const counted = await run(retrieval({ provider: many, extractor: null }), 'Paris', { maxResults: 3 });
    expect(counted.sources.map(source => source.sourceId)).toEqual(['fake:1', 'fake:2', 'fake:3']);
    expect(counted.providerResultCount).toBe(8);
    expect(counted.omitted).toEqual([4, 5, 6, 7, 8].map(n => ({ sourceId: `fake:${n}`, reason: 'result-limit' })));

    const long = 'Paris word '.repeat(600);
    const sized = await run(retrieval({ provider: provider(async () => [1, 2, 3].map(n => result(n, long))), extractor: null }), 'Paris',
      { maxSourceCharacters: 500, maxContextCharacters: 1200 });
    expect(sized.sources.every(source => source.passage.length <= 500 && source.truncated)).toBe(true);
    expect(sized.context.characters).toBeLessThanOrEqual(1200);
    expect(renderSourceContext(sized.sources).length).toBe(sized.context.characters);
    expect(sized.sources).toHaveLength(1);
    expect(sized.omitted).toEqual([{ sourceId: 'fake:2', reason: 'context-limit' }, { sourceId: 'fake:3', reason: 'context-limit' }]);

    // A provider that never answers and ignores its signal is still bounded by the time limit.
    const started = Date.now();
    const slow = await run(retrieval({ provider: provider(() => new Promise(() => {})), extractor: null }), 'Paris', { timeoutMs: 30 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(slow).toMatchObject({ outcome: 'failed', error: { code: 'timeout', stage: 'search' }, sources: [], context: null });
    const slowExtract = { id: 'slow.extract', version: '1', extract: () => new Promise(() => {}) };
    expect(await run(retrieval({ extractor: slowExtract }), 'Paris', { timeoutMs: 30 })).toMatchObject({ outcome: 'failed', error: { code: 'timeout', stage: 'extraction' } });

    expect(() => normalizeRetrievalLimits({ maxResults: 11 })).toThrow('maxResults is outside the policy limit');
    expect(() => normalizeRetrievalLimits({ timeoutMs: 0 })).toThrow('timeoutMs is outside the policy limit');
    expect(() => normalizeRetrievalLimits({ maxPages: 2 })).toThrow('Unknown retrieval limit');
    expect(() => retrieval().request({}, 'x'.repeat(513))).toThrow('Search query exceeds the retrieval limit');
    expect(() => retrieval().request({ query: '  ' }, 'Question')).toThrow('Search query is empty');
  });

  it('reports retrieval failure and never invents a source', async () => {
    const failing = await run(retrieval({ provider: provider(async () => { throw new Error('HTTP 503'); }), extractor: null }), 'Paris');
    expect(failing).toMatchObject({ outcome: 'failed', error: { code: 'provider-error', message: 'the search provider failed' },
      sources: [], context: null });
    expect(await run(retrieval(), 'unmatched zebra quasar')).toMatchObject({ outcome: 'empty', error: { code: 'no-results' },
      providerResultCount: 0, sources: [] });
    const { contentHash, ...unhashed } = result(1);
    expect(await run(retrieval({ provider: provider(async () => [unhashed]), extractor: null }), 'Paris'))
      .toMatchObject({ outcome: 'failed', error: { code: 'invalid-provider-result' }, sources: [] });
    const brokenExtract = { id: 'broken.extract', version: '1', extract: async ({ source }) => {
      if (source.sourceId === 'fixed:louvre') throw new Error('fetch failed');
      return fixed().extract({ source, query: 'Paris' });
    } };
    const partial = await run(retrieval({ extractor: brokenExtract }), 'Paris');
    expect(partial.sources.map(source => source.sourceId)).toEqual(['fixed:eiffel', 'fixed:seine']);
    expect(partial.omitted).toEqual([{ sourceId: 'fixed:louvre', reason: 'extraction-failed' }]);
    const noText = { id: 'none.extract', version: '1', extract: async () => { throw new Error('fetch failed'); } };
    expect(await run(retrieval({ extractor: noText }), 'Paris')).toMatchObject({ outcome: 'failed', error: { code: 'extraction-failed' }, sources: [] });
    await expect(retrieval().dispatch({ messages: [{ role: 'user', content: 'q' }] }, failing)).rejects.toThrow('Could not retrieve sources');
  });
});

describe('citation verification', () => {
  const record = async () => run(retrieval(), 'Eiffel Tower Paris completed');

  it('parses citation markers and maps each to its retrieved source', async () => {
    const answer = 'The Eiffel Tower was completed in 1889 [1]. The Louvre is the most visited art museum [2].\n'
      + '- The Seine flows through Paris. [3]\nParis has the tower and the museum [1, 2].\n\n```js\nconst first = list[1];\n```\n\n'
      + '## Sources\n[1] https://fixed.example/eiffel\n[2] https://fixed.example/louvre';
    expect(parseCitations(answer).claims.map(claim => [claim.text, claim.markers])).toEqual([
      ['The Eiffel Tower was completed in 1889.', [1]], ['The Louvre is the most visited art museum.', [2]],
      ['The Seine flows through Paris.', [3]], ['Paris has the tower and the museum.', [1, 2]]]);
    const verification = await verifyCitations({ answer, record: await record() });
    expect(verification.claims.map(claim => claim.citations.map(citation => [citation.marker, citation.sourceId, citation.resolved])))
      .toEqual([[[1, 'fixed:eiffel', true]], [[2, 'fixed:louvre', true]], [[3, 'fixed:seine', true]],
        [[1, 'fixed:eiffel', true], [2, 'fixed:louvre', true]]]);
    expect(verification.references.map(entry => entry.markers)).toEqual([[1], [2]]);
    expect(verification.unrecordedUrls).toEqual([]);
    // Without a support checker every resolved citation is unverified, never supported.
    expect(verification.checker).toBeNull();
    expect(verification.summary).toMatchObject({ claims: 4, citedClaims: 4, uncitedClaims: 0, citations: 5, supported: 0, unverified: 5 });
    expect(verification.claims[0].citations[0].support).toEqual({ verdict: 'unverified', reason: 'No support checker is configured.' });
  });

  it('flags a claim with no citation', async () => {
    const answer = 'The Eiffel Tower was completed in 1889 [1]. It is the tallest structure in France.\nThe sources say:';
    const verification = await verifyCitations({ answer, record: await record(), checker: createLexicalSupportChecker() });
    expect(verification.claims.map(claim => claim.text)).toEqual(['The Eiffel Tower was completed in 1889.', 'It is the tallest structure in France.']);
    expect(verification.flags).toEqual([{ kind: 'uncited-claim', claim: 1 }]);
    expect(verification.summary).toMatchObject({ claims: 2, citedClaims: 1, uncitedClaims: 1, supported: 1 });
  });

  it('flags a citation its source does not support', async () => {
    const answer = 'The Eiffel Tower was completed in 1889 [1]. The Eiffel Tower was completed in 1925 [1]. '
      + 'Bananas ripen faster beside apples [2].';
    const verification = await verifyCitations({ answer, record: await record(), checker: createLexicalSupportChecker() });
    expect(verification.checker).toEqual({ id: 'reploid.lexical-overlap-test', version: '1' });
    expect(verification.claims.map(claim => claim.citations[0].support.verdict)).toEqual(['supported', 'unsupported', 'unsupported']);
    expect(verification.flags).toEqual([
      { kind: 'unsupported-citation', claim: 1, marker: 1, reason: 'The source does not contain 1925.' },
      { kind: 'unsupported-citation', claim: 2, marker: 2, reason: '0 of 5 claim words appear in the source.' }]);

    const throwing = { id: 'judge', version: '1', check: async () => { throw new Error('judge offline'); } };
    const invalid = { id: 'judge', version: '1', check: async () => ({ verdict: 'probably' }) };
    for (const [checker, reason] of [[throwing, 'The support checker failed: judge offline'], [invalid, 'The support checker returned an invalid result.']]) {
      const checked = await verifyCitations({ answer: 'The tower is 330 metres tall [1].', record: await record(), checker });
      expect(checked.claims[0].citations[0].support).toEqual({ verdict: 'unverified', reason });
      expect(checked.flags).toEqual([{ kind: 'unverified-support', claim: 0, marker: 1 }]);
    }
  });

  it('flags invented sources: unresolved markers, mismatched references and URLs absent from the record', async () => {
    const answer = 'The tower opened in 1889 [7]. Read more at https://invented.example/tower.\n\nSources:\n'
      + '[1] https://fixed.example/louvre\n[9] https://invented.example/nine';
    const verification = await verifyCitations({ answer, record: await record() });
    expect(verification.flags).toEqual([
      { kind: 'unresolved-citation', claim: 0, marker: 7 }, { kind: 'uncited-claim', claim: 1 },
      { kind: 'mismatched-reference', marker: 1, url: 'https://fixed.example/louvre' }, { kind: 'unresolved-reference', marker: 9 },
      { kind: 'unrecorded-url', url: 'https://invented.example/tower' }, { kind: 'unrecorded-url', url: 'https://invented.example/nine' }]);
    expect(verification.summary.unresolvedCitations).toBe(1);
  });
});


it('keeps completed pages when another page exhausts the deadline and reports live progress', async () => {
  const results = [result(1), result(2)], updates = [];
  const port = retrieval({ provider: provider(async () => results), extractor: { id: 'mixed', version: '1',
    extract: ({ source }) => source.sourceId === 'fake:1'
      ? Promise.resolve({ ...source, text: source.excerpt }) : new Promise(() => {}) } });
  const record = await port.retrieve(port.pending(port.request({ limits: { timeoutMs: 30 } }, 'Paris'), 1), null,
    { onProgress: update => updates.push(update) });
  expect(record).toMatchObject({ outcome: 'retrieved', partial: true, error: null, sources: [{ sourceId: 'fake:1' }],
    omitted: [{ sourceId: 'fake:2', reason: 'extraction-timeout' }] });
  expect(updates[0]).toMatchObject({ stage: 'search' });
  expect(updates).toContainEqual({ stage: 'extraction', completed: 1, total: 2, available: 1 });
  expect(updates.at(-1)).toMatchObject({ stage: 'context', available: 1 });
});

it('discards partial pages on explicit cancellation even if a source succeeded', async () => {
  const controller = new AbortController(), results = [result(1), result(2)];
  const port = retrieval({ provider: provider(async () => results), extractor: { id: 'cancelled', version: '1',
    extract: ({ source }) => source.sourceId === 'fake:1' ? Promise.resolve({ ...source, text: source.excerpt }) : new Promise(() => {}) } });
  const record = await port.retrieve(port.pending(port.request({}, 'Paris'), 1), controller.signal,
    { onProgress: update => { if (update.available === 1) controller.abort(); } });
  expect(record).toMatchObject({ outcome: 'cancelled', sources: [], context: null });
});
