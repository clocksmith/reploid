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
const journalStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), values };
};
it('journals the latest draft synchronously until the async store confirms it', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; }), journal = journalStorage();
  const drafts = createChatDrafts({ ...options, storage: { getItem: () => '{}' }, journal, async persist() { await gate; } });
  const saved = drafts.save('new', { text: 'typed then reloaded', files: [] });
  expect(JSON.parse(journal.getItem('drafts:journal')).new.text).toBe('typed then reloaded');
  release(); await saved;
  expect(journal.getItem('drafts:journal')).toBeNull();
});
it('replays a journal left by an unloaded page into the store', async () => {
  const writes = [], journal = journalStorage({ 'drafts:journal': '{"new":{"text":"unsaved","files":[]}}' });
  const drafts = createChatDrafts({ ...options, storage: { getItem: () => '{"new":{"text":"older","files":[]}}' }, journal,
    async persist(raw) { writes.push(raw); } });
  expect(drafts.get('new').text).toBe('unsaved');
  await drafts.close();
  expect(writes).toEqual(['{"new":{"text":"unsaved","files":[]}}']);
  expect(journal.getItem('drafts:journal')).toBeNull();
});
it('keeps drafts out of the journal when none is supplied', async () => {
  const journal = journalStorage();
  const drafts = createChatDrafts({ ...options, storage: { getItem: () => '{}' }, async persist() {} });
  await drafts.save('new', { text: 'x', files: [] });
  expect(journal.values.size).toBe(0);
});
