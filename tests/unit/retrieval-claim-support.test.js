// REP-8 citation support: retained passages with offsets and hashes, claim-to-span mapping, deterministic citation
// validity, and the entailment reviewer interface (blinded human queue and stronger-model adapter). Fixed documents
// and injected reviewers only; no search provider, page fetch or model is involved, and nothing here judges support.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applySupportJudgments, assertIndependentReviewer, createFixedSearchProvider, createHumanReviewQueue, createModelSupportReviewer,
  createRetrieval, createSupportReviewPacket, mapClaimSpans, alignClaimSpan, renderSupportReviewPacketMarkdown, supportPacketHash,
  validSpan } from '../../packages/reploid/src/retrieval/index.js';

const sha = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const AT = 1760000000000;
const DOCUMENTS = [
  { id: 'fixed:eiffel', url: 'https://fixed.example/eiffel', title: 'Eiffel Tower',
    text: 'The tower is in Paris. The Eiffel Tower was completed in 1889 for the World Fair. It is 330 metres tall.' },
  { id: 'fixed:louvre', url: 'https://fixed.example/louvre', title: 'Louvre', text: 'The Louvre is the most visited art museum in the world.' }
];
const QUERY = 'Eiffel Tower completed Louvre museum';
const ANSWER = 'The Eiffel Tower was completed in 1889 [1]. The Louvre is the most visited museum [2]. Paris has many bridges. Its spire is gold [7].';
const GENERATOR = { modelId: 'qwen3.5-0.8b', modelIdentity: 'sha256:' + 'a'.repeat(64) };
const fixed = () => createFixedSearchProvider({ documents: DOCUMENTS, now: () => AT });
async function retrieved(ports = {}) {
  const provider = fixed(), port = createRetrieval({ provider, extractor: provider, ...ports });
  return { port, record: await port.retrieve(port.pending(port.request({}, QUERY), 1), null) };
}

describe('claim-to-span mapping and deterministic validity', () => {
  it('maps each claim to an exact hashed span of each cited passage and decides only what is mechanical', async () => {
    const { port, record } = await retrieved();
    const verification = await port.verify(ANSWER, record, null), mapped = verification.claimSupport;
    expect(mapped).toMatchObject({ schema: 'reploid.claim-support/v1', alignment: 'reploid.lexical-span-alignment/v1', contextValid: true });
    expect(mapped.claims.map(claim => [claim.id, claim.verdict, claim.reason])).toEqual([
      ['claim-1', 'unverified', 'awaiting-review'], ['claim-2', 'unverified', 'awaiting-review'],
      ['claim-3', 'unsupported', 'uncited'], ['claim-4', 'unsupported', 'unresolved-citation']]);
    const [first] = mapped.claims[0].citations, passage = record.sources[0].passage;
    // The span is the passage sentence that names the claim's words, never the whole document.
    expect(first).toMatchObject({ marker: 1, sourceId: 'fixed:eiffel', valid: true, problems: [], passageHash: sha(passage),
      span: { text: 'The Eiffel Tower was completed in 1889 for the World Fair.', alignment: 'sentence' } });
    expect(passage.slice(first.span.start, first.span.end)).toBe(first.span.text);
    expect(first.span.sha256).toBe(sha(first.span.text));
    expect(await validSpan(passage, first.span)).toBe(true);
    for (const broken of [{ ...first.span, start: first.span.start + 1 }, { ...first.span, sha256: sha('other') },
      { ...first.span, end: passage.length + 5 }]) expect(await validSpan(passage, broken)).toBe(false);
    expect(mapped.claims[3].citations[0]).toMatchObject({ marker: 7, valid: false, problems: ['unresolved-marker'] });
    expect(mapped.summary).toMatchObject({ claims: 4, citedClaims: 3, reviewableClaims: 2, validCitations: 2, invalidCitations: 1,
      supported: 0, unsupported: 2, unverified: 2 });
    expect(alignClaimSpan('Nothing in common here', 'Alpha beta. Gamma delta.')).toEqual({ start: 0, end: 24, alignment: 'whole-passage' });
  });

  it('marks citations invalid when the passage, context digest, reference URL or fetch provenance does not hold', async () => {
    const { record } = await retrieved();
    const tampered = structuredClone(record); tampered.sources[0].passage = tampered.sources[0].passage.replace('1889', '1890');
    const tamperedClaims = (await mapClaimSpans({ answer: ANSWER, record: tampered })).claims;
    expect(tamperedClaims[0].citations[0].problems).toEqual(expect.arrayContaining(['passage-hash-mismatch', 'context-digest-mismatch']));
    expect(tamperedClaims[0]).toMatchObject({ reviewable: false, verdict: 'unverified', reason: 'invalid-evidence' });
    // A source named by the search provider but never fetched and extracted is not a retrieved page.
    const excerpt = structuredClone(record); excerpt.sources[1].passageOrigin = 'search-excerpt';
    expect((await mapClaimSpans({ answer: ANSWER, record: excerpt })).claims[1].citations[0].problems).toContain('not-retrieved');
    const listed = `${ANSWER}\n\nSources:\n[1] https://elsewhere.example/eiffel`;
    expect((await mapClaimSpans({ answer: listed, record })).claims[0].citations[0].problems).toEqual(['mismatched-reference']);
  });

  it('retains extractor offsets through trimming and truncation, and records search usage even when retrieval fails', async () => {
    const document = '  Header.\n\nThe tower opened in 1889 and drew crowds every day of the fair.';
    const start = document.indexOf('The tower'), text = ' ' + document.slice(start);
    const provider = { id: 'test.search', version: '1', searchProvider: 'brave', async search() {
      return { results: [{ sourceId: 'web-1', url: 'https://example.org/a', title: 'A', excerpt: 'tower', retrievedAt: AT, contentHash: sha('tower') }],
        usage: { provider: 'brave', requests: 1, costMicroUsd: 5000 } };
    } };
    const extractor = { id: 'test.extract', version: '1', async extract({ source }) {
      return { sourceId: source.sourceId, text, retrievedAt: AT, contentHash: sha(document),
        document: { url: 'https://example.org/a', contentType: 'text/html', characters: document.length, sha256: sha(document),
          start: start - 1, end: document.length, bytes: 512, status: 200 } };
    } };
    const port = createRetrieval({ provider, extractor });
    const record = await port.retrieve(port.pending(port.request({ limits: { maxSourceCharacters: 30 } }, 'tower'), 1), null);
    const [source] = record.sources;
    expect(source.truncated).toBe(true);
    expect(document.slice(source.document.start, source.document.end)).toBe(source.passage);
    expect(source.document).toMatchObject({ sha256: sha(document), contentType: 'text/html', bytes: 512, status: 200 });
    expect(record.usage).toEqual({ search: { provider: 'brave', requests: 1, costMicroUsd: 5000 }, extraction: { documents: 1, bytes: 512 } });
    // Offsets that do not span the passage are an invalid provider result for that source.
    const lying = { ...extractor, async extract(input) { const value = await extractor.extract(input); value.document.end -= 3; return value; } };
    const failed = await createRetrieval({ provider, extractor: lying }).retrieve(port.pending(port.request({}, 'tower'), 1), null);
    expect(failed).toMatchObject({ outcome: 'failed', error: { code: 'extraction-failed' }, sources: [],
      usage: { search: { provider: 'brave', requests: 1, costMicroUsd: 5000 } } });
  });
});

const judgment = (packet, sha256, reviewer, verdicts) => ({ schema: 'reploid.claim-support-judgments/v1', packet: { id: packet.id, sha256 }, reviewer,
  judgments: Object.entries(verdicts).map(([claim, [verdict, spans = []]]) => ({ claim, verdict, basis: `${verdict} by ${reviewer.id}.`, spans })) });
const human = id => ({ kind: 'human', id });

describe('entailment review', () => {
  async function packetFor() {
    const { port, record } = await retrieved();
    const claimSupport = (await port.verify(ANSWER, record, null)).claimSupport;
    const packet = createSupportReviewPacket({ id: 'support-001', question: QUERY, answer: ANSWER, record, claimSupport });
    return { record, claimSupport, packet, sha256: await supportPacketHash(packet) };
  }

  it('builds a blinded packet: claims, spans and passages, without generator, attempt or contributor identity', async () => {
    const { packet } = await packetFor();
    expect(packet.claims.map(claim => claim.id)).toEqual(['claim-1', 'claim-2']);
    expect(packet.sources.map(source => source.number)).toEqual([1, 2]);
    expect(packet.claims[0].citations).toEqual([{ source: 1, suggestedSpan: expect.objectContaining({
      text: 'The Eiffel Tower was completed in 1889 for the World Fair.' }) }]);
    const serialized = JSON.stringify(packet);
    for (const hidden of [GENERATOR.modelId, GENERATOR.modelIdentity, 'attempt', 'thread', 'peer:', 'recipients', 'model']) {
      expect(serialized.toLowerCase()).not.toContain(hidden.toLowerCase());
    }
    const markdown = renderSupportReviewPacketMarkdown(packet);
    expect(markdown).toContain('### claim-1'); expect(markdown).toContain('suggested span');
    expect(markdown).toContain(`Passage sha256: \`${packet.sources[0].passageSha256}\``);
  });

  it('never lets the generating model certify its own claims, by name or content identity', async () => {
    const { packet, claimSupport, sha256 } = await packetFor();
    for (const reviewer of [{ kind: 'model', id: 'local/Qwen3.5-0.8B', model: { provider: 'local', name: 'Qwen3.5-0.8B' } },
      { kind: 'model', id: 'renamed', model: { provider: 'local', name: 'renamed', identity: GENERATOR.modelIdentity } }]) {
      expect(() => assertIndependentReviewer(reviewer, GENERATOR)).toThrow('The generating model cannot certify its own claims');
      await expect(applySupportJudgments({ packet, claimSupport, generator: GENERATOR,
        judgments: [judgment(packet, sha256, reviewer, { 'claim-1': ['supported', [{ source: 1, quote: 'completed in 1889' }]] })] }))
        .rejects.toThrow('cannot certify its own claims');
    }
    await expect(applySupportJudgments({ packet, claimSupport, generator: null, judgments: [] })).rejects.toThrow('generating model identity is required');
  });

  it('queues the packet for two blinded human reviewers, and lets a third reviewer decide their disagreements', async () => {
    const { packet, claimSupport, sha256 } = await packetFor();
    const queue = createHumanReviewQueue({ now: () => AT });
    expect(await queue.review(packet, { generator: GENERATOR, claimSupport })).toBeNull();
    const [waiting] = await queue.pending();
    expect(waiting).toEqual({ packet, sha256, reviews: 0 });
    expect(JSON.stringify(await queue.pending())).not.toContain(GENERATOR.modelIdentity);

    const span = [{ source: 1, quote: 'The Eiffel Tower was completed in 1889' }];
    await queue.submit(judgment(packet, sha256, human('reviewer-a'), { 'claim-1': ['supported', span], 'claim-2': ['supported', [{ source: 2, start: 0, end: 40 }]] }));
    await expect(queue.submit(judgment(packet, sha256, human('reviewer-a'), {}))).rejects.toThrow('already judged');
    await expect(queue.submit(judgment(packet, 'sha256:' + '0'.repeat(64), human('reviewer-z'), {}))).rejects.toThrow('do not belong to this review packet');
    await expect(queue.submit(judgment(packet, sha256, { kind: 'model', id: 'x', model: { provider: 'p', name: 'x' } }, {})))
      .rejects.toThrow('accepts human judgment files');
    const status = await queue.submit(judgment(packet, sha256, human('reviewer-b'), { 'claim-1': ['supported', span], 'claim-2': ['unsupported'] }));
    expect(status).toMatchObject({ reviews: 2, disagreements: ['claim-2'], needsThirdReview: true, complete: false });
    expect((await queue.pending())[0].thirdReviewClaims).toEqual(['claim-2']);

    // Before the third review the two disagreeing verdicts leave claim-2 disputed.
    expect((await queue.result(packet.id)).claims[1]).toMatchObject({ verdict: 'unverified', reason: 'disputed', disputed: true });
    await queue.submit(judgment(packet, sha256, human('reviewer-c'), { 'claim-2': ['unsupported'] }));
    const result = await queue.result(packet.id);
    expect(result.claims.map(claim => [claim.id, claim.verdict, claim.reason])).toEqual([['claim-1', 'supported', 'reviewed'],
      ['claim-2', 'unsupported', 'third-review'], ['claim-3', 'unsupported', 'uncited'], ['claim-4', 'unsupported', 'unresolved-citation']]);
    expect(result.claims[1].reviews.map(review => [review.reviewer.id, review.verdict]))
      .toEqual([['reviewer-a', 'supported'], ['reviewer-b', 'unsupported'], ['reviewer-c', 'unsupported']]);
    expect(result.claims[0].reviews[0].spans[0]).toMatchObject({ source: 1, text: 'The Eiffel Tower was completed in 1889' });
    expect(result.claims[0].evidence[0]).toMatchObject({ source: 1, url: 'https://fixed.example/eiffel', passageHash: claimSupport.claims[0].citations[0].passageHash });
    expect(result.summary).toMatchObject({ claims: 4, supported: 1, unsupported: 3, unverified: 0, disputed: 0, resolvedByThirdReview: 1,
      supportRate: 0.25 });
    await expect(queue.submit(judgment(packet, sha256, human('reviewer-d'), {}))).rejects.toThrow('needs no further review');
  });

  it('keeps a claim disputed when three reviews hold no majority verdict', async () => {
    const { packet, claimSupport, sha256 } = await packetFor();
    const span = [{ source: 1, quote: 'The Eiffel Tower was completed in 1889' }];
    const result = await applySupportJudgments({ packet, claimSupport, generator: GENERATOR, judgments: [
      judgment(packet, sha256, human('reviewer-a'), { 'claim-1': ['supported', span] }),
      judgment(packet, sha256, human('reviewer-b'), { 'claim-1': ['unsupported'] }),
      judgment(packet, sha256, human('reviewer-c'), { 'claim-1': ['unverified'] })] });
    expect(result.claims[0]).toMatchObject({ verdict: 'unverified', reason: 'disputed', disputed: true });
    expect(result.summary).toMatchObject({ disputed: 1, resolvedByThirdReview: 0 });
  });

  it('downgrades support that cites no exact span of a cited passage', async () => {
    const { packet, claimSupport, sha256 } = await packetFor();
    const result = await applySupportJudgments({ packet, claimSupport, generator: GENERATOR, judgments: [judgment(packet, sha256, human('reviewer-a'), {
      'claim-1': ['supported', [{ source: 1, quote: 'not in the passage' }]], 'claim-2': ['supported', [{ source: 1, start: 0, end: 10 }]] })] });
    expect(result.claims.slice(0, 2).map(claim => [claim.verdict, claim.reviews[0].basis.startsWith('Marked supported without a valid span')]))
      .toEqual([['unverified', true], ['unverified', true]]);
  });

  it('runs a configured stronger model only on answers from models it is declared stronger than', async () => {
    const { packet, claimSupport } = await packetFor();
    expect(() => createModelSupportReviewer({})).toThrow('off unless its provider and model are configured');
    expect(() => createModelSupportReviewer({ identity: { provider: 'p', model: 'm' }, strongerThan: [], complete: async () => '' }))
      .toThrow('must name the generating models it is stronger than');
    const prompts = [];
    const reviewer = createModelSupportReviewer({ identity: { provider: 'example-provider', model: 'reviewer-large', version: '2026-09' },
      strongerThan: ['Qwen3.5-0.8B'], complete: async input => { prompts.push(input);
        return '```json\n{"judgments":[{"claim":"claim-1","verdict":"supported","basis":"States the year.","spans":[{"source":1,"quote":"completed in 1889"}]},'
          + '{"claim":"claim-2","verdict":"unsupported","basis":"The passage says art museum."}]}\n```'; } });
    const judgments = await reviewer.review(packet, { generator: GENERATOR });
    expect(judgments.reviewer).toEqual({ kind: 'model', id: 'example-provider/reviewer-large',
      model: { provider: 'example-provider', name: 'reviewer-large', version: '2026-09' } });
    expect(prompts[0].prompt).toContain('claim-1: The Eiffel Tower was completed in 1889.');
    expect(prompts[0].prompt).not.toContain(GENERATOR.modelId);
    const result = await applySupportJudgments({ packet, claimSupport, judgments: [judgments], generator: GENERATOR });
    expect(result.claims.slice(0, 2).map(claim => claim.verdict)).toEqual(['supported', 'unsupported']);

    await expect(reviewer.review(packet, { generator: { modelId: 'other-model', modelIdentity: 'sha256:' + 'b'.repeat(64) } }))
      .rejects.toThrow('not configured as stronger than the generating model');
    const self = createModelSupportReviewer({ identity: { provider: 'local', model: 'qwen3.5-0.8b' }, strongerThan: ['qwen3.5-0.8b'], complete: async () => '{}' });
    await expect(self.review(packet, { generator: GENERATOR })).rejects.toThrow('cannot certify its own claims');
  });
});
