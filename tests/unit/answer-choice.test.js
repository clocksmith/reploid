import { expect, it } from 'vitest';
import { ANSWER_CHOICE_STORAGE_KEY, findAnswerChoice, readAnswerChoice, writeAnswerChoice } from '../../apps/poolday/ui/pool-home/answer-choice.js';

const memory = (entries = {}) => {
  const saved = new Map(Object.entries(entries));
  return { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)), saved };
};

it('keeps a model and Contributors or This device, and never a named computer', () => {
  const storage = memory(), model = { id: 'qwen-small', identity: 'sha256:a' };
  writeAnswerChoice(storage, model, 'contributors');
  expect(readAnswerChoice(storage)).toEqual({ selectionId: 'qwen-small', identity: 'sha256:a', route: 'contributors', picked: false });
  writeAnswerChoice(storage, { ...model, selectionId: 'qwen-small/adapter' }, 'device', true);
  expect(readAnswerChoice(storage)).toEqual({ selectionId: 'qwen-small/adapter', identity: 'sha256:a', route: 'device', picked: true });
  writeAnswerChoice(storage, model, 'desktop');
  expect(readAnswerChoice(storage).route).toBeNull();
});

it('reads a record as a pick only when it says so', () => {
  const record = { selectionId: 'qwen-small', identity: 'sha256:a', route: 'contributors' };
  // A record written before picks were marked names a computer, not a model the person chose.
  expect(readAnswerChoice(memory({ [ANSWER_CHOICE_STORAGE_KEY]: JSON.stringify(record) })).picked).toBe(false);
  expect(readAnswerChoice(memory({ [ANSWER_CHOICE_STORAGE_KEY]: JSON.stringify({ ...record, picked: 'yes' }) })).picked).toBe(false);
  expect(readAnswerChoice(memory({ [ANSWER_CHOICE_STORAGE_KEY]: JSON.stringify({ ...record, picked: true }) })).picked).toBe(true);
});

it('reads nothing from missing, malformed or unreadable storage, and writing never throws', () => {
  expect(readAnswerChoice(null)).toBeNull();
  expect(readAnswerChoice(memory({ [ANSWER_CHOICE_STORAGE_KEY]: '{' }))).toBeNull();
  expect(readAnswerChoice(memory({ [ANSWER_CHOICE_STORAGE_KEY]: JSON.stringify({ selectionId: 7 }) }))).toBeNull();
  expect(readAnswerChoice({ getItem() { throw new Error('denied'); } })).toBeNull();
  expect(() => writeAnswerChoice({ setItem() { throw new Error('quota'); } }, { id: 'm', identity: null }, 'device')).not.toThrow();
});

it('finds a remembered model only under the same selection and identity', () => {
  const choice = { selectionId: 'big', identity: 'sha256:b', route: 'contributors' };
  const big = { id: 'big', identity: 'sha256:b' };
  expect(findAnswerChoice(choice, [{ id: 'small', identity: 'sha256:s' }, big])).toBe(big);
  // A different build under the same name is not the model the person chose.
  expect(findAnswerChoice(choice, [{ ...big, identity: 'sha256:c' }])).toBeNull();
  expect(findAnswerChoice({ ...choice, selectionId: 'big/adapter' }, [big, { ...big, selectionId: 'big/adapter' }]).selectionId).toBe('big/adapter');
  expect(findAnswerChoice(null, [big])).toBeNull();
});
