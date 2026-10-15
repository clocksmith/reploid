// @vitest-environment node
// The operator-configured stronger-model support reviewer: off unless fully configured, key outside the repository,
// OpenAI-compatible request shape, and the library's independence rules. The model endpoint is injected.
import { describe, expect, it, vi } from 'vitest';
import { createConfiguredSupportReviewer, readSupportReviewerConfig } from '../../server/search/support-reviewer.js';

const ENV = { REPLOID_SUPPORT_REVIEWER_ENDPOINT: 'https://models.example/v1/chat/completions', REPLOID_SUPPORT_REVIEWER_PROVIDER: 'example',
  REPLOID_SUPPORT_REVIEWER_MODEL: 'reviewer-large', REPLOID_SUPPORT_REVIEWER_STRONGER_THAN: 'qwen3.5-0.8b, other-small',
  REPLOID_SUPPORT_REVIEWER_API_KEY: 'secret-reviewer-key' };
const packet = { schema: 'reploid.claim-support-review-packet/v1', id: 'p1', instructions: ['Judge.'], question: 'Q', answer: 'A [1].',
  sources: [{ number: 1, title: 'T', url: 'https://example.org', retrievedAt: 1, passage: 'A is true.', passageSha256: 'sha256:' + '0'.repeat(64) }],
  claims: [{ id: 'claim-1', text: 'A.', quote: { start: 0, end: 2 }, citations: [{ source: 1, suggestedSpan: { start: 0, end: 10, text: 'A is true.', sha256: 'x' } }] }] };
const generator = { modelId: 'qwen3.5-0.8b', modelIdentity: 'sha256:' + 'a'.repeat(64) };

describe('configured support reviewer', () => {
  it('is off unless every setting and a key outside the repository are present', () => {
    expect(readSupportReviewerConfig({})).toEqual({ enabled: false, reason: 'No support reviewer is configured' });
    expect(readSupportReviewerConfig({ ...ENV, REPLOID_SUPPORT_REVIEWER_STRONGER_THAN: '' }).reason).toContain('REPLOID_SUPPORT_REVIEWER_STRONGER_THAN');
    expect(readSupportReviewerConfig({ ...ENV, REPLOID_SUPPORT_REVIEWER_ENDPOINT: 'http://models.example/v1' }).enabled).toBe(false);
    const { REPLOID_SUPPORT_REVIEWER_API_KEY: _key, ...keyless } = ENV;
    expect(readSupportReviewerConfig({ ...keyless, REPLOID_SUPPORT_REVIEWER_API_KEY_FILE: '/repo/keys/reviewer' }, { repoRoot: '/repo' }).reason)
      .toBe('REPLOID_SUPPORT_REVIEWER_API_KEY_FILE must be outside the repository');
    const read = vi.fn(() => ' file-key \n');
    expect(readSupportReviewerConfig({ ...keyless, REPLOID_SUPPORT_REVIEWER_API_KEY_FILE: '/secrets/reviewer' }, { repoRoot: '/repo', readFileSync: read }))
      .toMatchObject({ enabled: true, apiKey: 'file-key', strongerThan: ['qwen3.5-0.8b', 'other-small'] });
    expect(createConfiguredSupportReviewer({ env: {} })).toBeNull();
  });

  it('sends the blinded packet to the configured endpoint and refuses models it is not declared stronger than', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content:
      '{"judgments":[{"claim":"claim-1","verdict":"supported","basis":"Stated.","spans":[{"source":1,"quote":"A is true."}]}]}' } }] }) }));
    const reviewer = createConfiguredSupportReviewer({ env: ENV, fetch });
    const judgments = await reviewer.review(packet, { generator });
    const [url, init] = fetch.mock.calls[0], body = JSON.parse(init.body);
    expect(url).toBe(ENV.REPLOID_SUPPORT_REVIEWER_ENDPOINT);
    expect(init.headers.Authorization).toBe('Bearer secret-reviewer-key');
    expect(body).toMatchObject({ model: 'reviewer-large', temperature: 0 });
    expect(body.messages[1].content).not.toContain(generator.modelId);
    expect(judgments).toMatchObject({ reviewer: { kind: 'model', id: 'example/reviewer-large' }, judgments: [{ claim: 'claim-1', verdict: 'supported' }] });
    await expect(reviewer.review(packet, { generator: { modelId: 'unlisted', modelIdentity: 'sha256:' + 'b'.repeat(64) } }))
      .rejects.toThrow('not configured as stronger');
    const failing = createConfiguredSupportReviewer({ env: ENV, fetch: async () => ({ ok: false, status: 401 }) });
    const error = await failing.review(packet, { generator }).catch(caught => caught);
    expect(error.message).toBe('The support reviewer returned HTTP 401');
    expect(error.message).not.toContain('secret-reviewer-key');
  });
});
