import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { ledgerCatalog } from '../adapter.js';
import { flatSchema } from './adapter.js';
const suite = JSON.parse(await readFile(new URL('./suite.json', import.meta.url)));
const parent = JSON.parse(await readFile(new URL('../../available-typed/suite.json', import.meta.url)));
for (const key of ['cases', 'generation', 'enableThinking', 'modelId', 'sourceRevision', 'toolAttributionCriteria']) {
  assert.deepEqual(suite[key], parent[key], `Unchanged contract: ${key}`);
}
const cases = suite.cases.map(task => {
  const catalog = ledgerCatalog(task.messages);
  const entries = catalog.facts.map(({ id, source, kind, value }) => ({ id, source, kind, value }));
  const original = structuredClone(task.messages);
  const messages = [{ role: 'system', content: suite.instruction }, ...original,
    { role: 'user', content: suite.catalogInstruction + '\n<reploid-literal-catalog-v1>\n'
      + JSON.stringify({ entries, scope: 'Source-exact literals only; no semantic conclusions.' })
      + '\n</reploid-literal-catalog-v1>' }];
  assert.deepEqual(messages.slice(1, -1), task.messages);
  return { id: task.id, messages, schema: flatSchema(task.messages), originalMessages: original };
});
await writeFile(new URL('./inputs.json', import.meta.url), JSON.stringify({ cases }, null, 2) + '\n');
console.log(`Prepared ${cases.length} unchanged ordered histories; no model output.`);
