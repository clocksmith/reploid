import { it, expect } from 'vitest';
import { createChatDrafts } from '../../self/host/chat-drafts.js';
const options = { key: 'drafts', maxThreads: 4, maxCharacters: 100, maxFiles: 2, maxFileBytes: 100, maxInputBytes: 100 };
it('keeps queued drafts invisible until persisted and merges concurrent thread writes', async () => {
  let release, began;
  const entered = new Promise(resolve => { began = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const writes = [], drafts = createChatDrafts({ ...options, storage: { getItem: () => '{"a":{"text":"old","files":[]}}' },
    async persist(raw) { writes.push(raw); if (writes.length === 1) { began(); await gate; } } });
  const value = { text: 'new', files: [] }, first = drafts.save('a', value); value.text = 'mutated';
  const second = drafts.save('b', { text: 'other thread', files: [] }); await entered;
  expect(drafts.get('a').text).toBe('old'); expect(drafts.get('b').text).toBe('');
  release(); await Promise.all([first, second]);
  expect(drafts.get('a').text).toBe('new'); expect(drafts.get('b').text).toBe('other thread');
  expect(Object.keys(JSON.parse(writes[1]))).toEqual(['a', 'b']); await drafts.close();
  expect(() => drafts.save('a', null)).toThrow('closed');
});
it('preserves the last saved draft and fences an unknown commit result', async () => {
  const drafts = createChatDrafts({ ...options, storage: { getItem: () => '{"a":{"text":"old","files":[]}}' },
    async persist() { throw Error('receipt lost after possible commit'); } });
  await expect(drafts.save('a', { text: 'unknown', files: [] })).rejects.toThrow('receipt lost');
  expect(drafts.get('a').text).toBe('old'); expect(() => drafts.save('b', { text: 'later', files: [] })).toThrow('unknown');
  await expect(drafts.close()).rejects.toThrow('receipt lost');
});
it('validates attachments before calling async persistence', () => {
  let writes = 0;
  const drafts = createChatDrafts({ ...options, persist() { writes++; } });
  expect(() => drafts.save('a', { text: 'ok', files: [{ name: 'large', text: 'x'.repeat(101) }] })).toThrow('allowance');
  expect(writes).toBe(0);
});
