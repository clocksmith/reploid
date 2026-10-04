import { describe, it, expect } from 'vitest';
import { comparisonInput, comparisonSources, comparisonExport } from '../../self/host/document-comparison.js';
import { createChatSession } from '../../self/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';
import sample from '../../self/config/document-comparison-sample.json' with { type: 'json' };
const storage = () => { const values = new Map(); return { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }; };

describe('Document workflow ownership', () => {
  it('preserves quoted text and passage identities through history and export', () => {
    const input = comparisonInput(sample.question, sample.files);
    const result = comparisonSources(input);
    expect(result.documents[2].passages[1].text).toContain('Page 2 states all plumbing work is excluded');
    expect(result.documents[0].passages[0].id).toBe('D1:P1');
    expect(comparisonSources('ordinary conversation')).toBeNull();
    expect(comparisonSources(input.replace('"D1:P1"', '"D2:P1"'))).toBeNull();
    expect(comparisonExport({ messages: [{ role: 'user', content: input, status: 'completed' }] })).toContain('[D3:P2] Page 1');
  });
  it('runs the checking pass as a separate retained attempt using injected execution', async () => {
    const session = createChatSession({ storage: storage(), service: createChatTestService() });
    const id = session.createThread({ sharingScope: 'local' });
    const result = await session.compareDocuments(id, sample.question, sample.files);
    expect(result.status).toBe('completed');
    const thread = session.getState().activeThread;
    expect(thread.attempts.map(attempt => attempt.status)).toEqual(['completed', 'completed']);
    expect(thread.attempts[0].id).not.toBe(thread.attempts[1].id);
    expect(thread.messages[2].content).toContain('Independently recompute');
    expect(session.exportConversation(id)).toContain('not guarantee factual accuracy');
    await session.close();
  });
  it('does not launch checking after cancellation', async () => {
    const service = createChatTestService({ delayMs: 100 });
    const session = createChatSession({ storage: storage(), service });
    const id = session.createThread({ sharingScope: 'local' });
    const completion = session.compareDocuments(id, sample.question, sample.files);
    session.cancel(id); await completion;
    expect(session.getState().activeThread.attempts).toHaveLength(1);
    expect(session.getState().activeThread.attempts[0].status).toBe('cancelled');
    await session.close();
  });
  it('restores drafts without executing or mixing threads', async () => {
    const store = storage(), service = createChatTestService();
    const session = createChatSession({ storage: store, service });
    session.saveDraft('thread-a', { text: 'A', files: sample.files });
    session.saveDraft('thread-b', { text: 'B', files: [] });
    await session.close();
    const restored = createChatSession({ storage: store, service });
    expect(restored.getDraft('thread-a').files).toEqual(sample.files);
    expect(restored.getDraft('thread-b').text).toBe('B');
    expect(service.calls).toHaveLength(0);
    restored.saveDraft('thread-a', null);
    expect(restored.getDraft('thread-a').files).toEqual([]);
    expect(() => restored.saveDraft('thread-b', { text: 'x'.repeat(16385), files: [] })).toThrow('allowance');
    expect(restored.getDraft('thread-b').text).toBe('B');
    await restored.close();
  });
});
