import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { sourceRows, rowSchema, calculateRows } from './adapter.js';
const root = new URL('./', import.meta.url);
const suite = JSON.parse(await readFile(new URL('suite.json', root)));
const parent = JSON.parse(await readFile(new URL('../flat-experiment/suite.json', root)));
for (const key of ['cases', 'generation', 'enableThinking', 'modelId', 'sourceRevision', 'toolAttributionCriteria', 'aggregateBudgets']) {
  assert.deepEqual(suite[key], parent[key], `Unchanged: ${key}`);
}
const cases = [];
for (const task of suite.cases) {
  const rows = sourceRows(task.messages);
  const data = {
    facts: rows.facts.map(({ kind, value, source, quote }) => ({ kind, value, source, quote })),
    passages: rows.passages.map(({ id, text }) => ({ id, text })),
  };
  const original = structuredClone(task.messages);
  const selectionMessages = [{ role: 'system', content: suite.selectionInstruction }, ...original,
    { role: 'user', content: 'Tag these exact ordered rows. No roles are preselected.\n<source-rows-v1>\n'
      + JSON.stringify(data) + '\n</source-rows-v1>' }];
  const blank = { factRoles: rows.facts.map(() => []), passageRelations: rows.passages.map(() => []) };
  const emptyCall = '<tool_call>\n' + JSON.stringify({ name: 'AnnotateSource', arguments: blank }) + '\n</tool_call>';
  const emptyResult = await calculateRows(blank, original);
  const minimumAnswerMessages = [{ role: 'system', content: suite.answerInstruction }, ...structuredClone(original),
    { role: 'assistant', content: emptyCall }, { role: 'tool', content: JSON.stringify({ ok: true, result: emptyResult }) }];
  assert.deepEqual(selectionMessages.slice(1, -1), task.messages);
  assert.deepEqual(minimumAnswerMessages.slice(1, -2), task.messages);
  cases.push({ id: task.id, originalMessages: original, selectionMessages, schema: rowSchema(original),
    emptySelectionControl: blank, minimumAnswerMessages,
    preflightScope: 'Empty selections are a preparation control only; no model answer or semantic default.' });
}
await writeFile(new URL('inputs.json', root), JSON.stringify({ cases }, null, 2) + '\n');
console.log(`Prepared ${cases.length} exact histories; no model execution.`);
