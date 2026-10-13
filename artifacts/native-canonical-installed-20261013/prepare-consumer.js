// Test-only composition. Explicit selected tokens and decoded text replace model
// computation; installed public transition, identity and crypto remain genuine.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const [application, source, consumer] = process.argv.slice(2);
assert(application && source && consumer, 'Frozen application, source and installed consumer required');
await mkdir(path.join(consumer, 'tests/fixtures'), { recursive: true });
await cp(path.join(application, 'packages'), path.join(consumer, 'packages'), { recursive: true });
await cp(path.join(source, 'tests/fixtures/canonical-generation-policy.json'), path.join(consumer, 'tests/fixtures/canonical-generation-policy.json'));
let fixture = await readFile(path.join(application, 'tests/canonical-publication-evidence-source.js'), 'utf8');
const before = fixture;
fixture = fixture.replace("import { pathToFileURL } from 'node:url';\n", '');
const begin = fixture.indexOf('const root = process.env.DOPPLER_SOURCE_ROOT;');
const end = fixture.indexOf("const hash = 'sha256:'");
assert(begin > 0 && end > begin);
fixture = fixture.slice(0, begin) + `const runtime = await import('doppler-gpu/partitions');
const policy = JSON.parse(await readFile(new URL('./fixtures/canonical-generation-policy.json', import.meta.url), 'utf8'));
` + fixture.slice(end);
const computeBegin = fixture.indexOf('const decoder = () =>');
const computeEnd = fixture.indexOf('const authorities =');
assert(computeBegin > 0 && computeEnd > computeBegin);
fixture = fixture.slice(0, computeBegin) + `const admitted = runtime.admitResidentPrompt([1, 2], policy, 100, generation.generationId);
assert.deepEqual(admitted.tokenIds, [1, 2]);
// Deliberately injected computation: selected token 3 and decoded text "3".
const transition = { acceptedTokenIds: [3], tokenRange: { start: 0, end: 1 },
  successor: runtime.bootstrapResidentCursor([1, 2], 3, policy, 100, generation.generationId),
  delta: '3', outputDigest: runtime.metadataDigest('test.explicit-output/v1', { text: '3' }) };
const next = runtime.decideResidentBlock(transition.successor, [1, 2], [], [4], [false], policy, 100);
assert.deepEqual(next.acceptedTokenIds, [4]);
assert.equal(next.successor.revision, 1);
assert.equal(next.successor.materializedTokenCount, 3);
assert.equal(next.successor.pendingTokenId, 4);
assert.throws(() => runtime.decideResidentBlock(transition.successor, [1, 9], [], [4], [false], policy, 100), /history mismatch/);
` + fixture.slice(computeEnd);
assert.equal(fixture.slice(fixture.indexOf('const authorities =')), before.slice(before.indexOf('const authorities =')),
  'All existing signature/publication/fault controls must remain unchanged');
assert(!fixture.includes('pathToFileURL') && !fixture.includes('/src/inference/'));
await writeFile(path.join(consumer, 'tests/publication-installed.js'), fixture);
console.log('Prepared installed public-contract consumer; unchanged publication control suffix verified');
