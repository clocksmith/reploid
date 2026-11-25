// One retained development input candidate; no model execution or evaluator changes.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HARNESS, fail, loadJson, sha256File } from './common.js';

export const CANDIDATE = 'whole-passages-250';
const FIXTURE_SHA256 = 'b013d023d522ff42b07feb5dc91d523287d4ae581c29440db6d7db4c66747eda';
const INPUT_SHA256 = 'd71ebf6f9d1d6f9c2c4c51c7ba2a4d684fec5fe77760bc96538eca64ca59f6b9';

/** [identity, rows by item id, policy] for the retained candidate, after its read-only public-API replay. */
export function loadCandidate(name) {
  if (name !== CANDIDATE) fail('Unknown retained context candidate');
  const directory = path.join(HARNESS, 'context-candidates');
  const fixturePath = path.join(directory, 'whole-passages-250.json');
  if (sha256File(fixturePath) !== FIXTURE_SHA256) fail('The retained context candidate changed');
  // Reuse the existing public-API replay and identity validator. It is read-only.
  const done = spawnSync(process.execPath, [path.join(HARNESS, 'test-context-candidate.js')], { encoding: 'utf8', timeout: 30000 });
  if (done.status !== 0) fail(`The retained context candidate failed public retrieval replay: ${(done.stderr || '').slice(-400)}`);
  const identity = loadJson(path.join(directory, 'identity.json'));
  if (identity.selectedInputSha256 !== INPUT_SHA256) fail('The retained context candidate identity changed');
  const fixture = loadJson(fixturePath);
  const selected = fixture.variants.find(row => row.id === fixture.selectedCandidate);
  return [{ id: CANDIDATE, selectedInputSha256: INPUT_SHA256, fixtureSha256: FIXTURE_SHA256 },
    Object.fromEntries(selected.items.map(row => [row.id, row])), fixture.policy];
}

const sameIdentity = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/** [rows, policy] when the run binds the retained candidate, else null. */
export function candidateForRun(run) {
  const identity = run.itemSet.contextCandidate;
  if (identity === undefined || identity === null) return null;
  if (run.itemSet.kind !== 'search') fail('Context candidates apply only to search runs');
  const [expected, rows, policy] = loadCandidate(identity.id);
  if (!sameIdentity(identity, expected)) fail('Run does not bind the exact retained context candidate');
  return [rows, policy];
}
