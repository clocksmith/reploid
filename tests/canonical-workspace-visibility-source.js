// Persistence scheduling control. Store and execution are injected; real signed
// transaction/reopen coverage is in canonical-workspace-history-source.js.
import assert from 'node:assert/strict';
import { createChatWorkspace } from '../packages/reploid/src/chat/workspace.js';
const saves = [], viewers = [], nextTurn = () => new Promise(resolve => setImmediate(resolve));
let controls, complete, calls = 0, request;
const store = { mode: 'transactional', writerEpoch: '0'.repeat(32), load: () => null,
  save(value) { return new Promise(resolve => saves.push({ value: structuredClone(value), resolve })); },
  assertCurrentWriter: async () => {}, publication: async () => ({ requiresCommitEvidence: true }),
  project: async (threadId, attemptId) => ({ threadId, attemptId, content: 'saved', publicationDigests: ['digest'], terminal: true }) };
let id = 0;
const app = createChatWorkspace({ store, meshId: 'mesh', participantId: 'requester', id: () => 'id-' + ++id,
  execute(input, port) { calls++; request = input; controls = port; return new Promise(resolve => { complete = resolve; }); } });
app.subscribe(value => viewers.push(value));
const model = { id: 'model', name: 'model', identity: 'sha256:' + 'a'.repeat(64) };
const first = app.createThread({ model });
assert.equal(app.getState().threads.length, 0);
app.select(null); assert.equal(viewers.at(-1).threads.length, 0);
saves[0].resolve(); const a = await first;
const second = app.createThread({ model });
const rename = app.renameThread(a, 'pending title');
saves[1].resolve(); const b = await second;
assert.equal(app.getState().threads[0].title, undefined, 'Earlier save must not expose a later pending mutation');
app.select(a); assert.equal(viewers.at(-1).threads[0].title, undefined);
saves[2].resolve(); await rename;
const result = app.send(a, 'question');
app.select(b);
assert.equal(app.getState().threads[0].messages.length, 0, 'Admission remains invisible until storage commits');
assert.equal(calls, 0);
saves[3].resolve(); await nextTurn(); assert.equal(calls, 1);
controls.onState({ threadId: a, attemptId: request.attemptId, status: 'executing' });
assert.equal(app.getState().ephemeralExecutions[0].status, 'executing');
assert.equal(app.getState().threads[0].attempts[0].status, 'queued');
assert.throws(() => controls.onDelta({ threadId: a, attemptId: request.attemptId, text: 'raw', sequence: 0 }), /saved publication/);
const projection = controls.onPublished({}); await nextTurn();
app.select(b);
assert.equal(app.getState().threads[0].messages.at(-1).content, '', 'Another thread cannot expose a pending metadata projection');
saves[4].resolve(); await projection;
assert.equal(app.getState().threads[0].messages.at(-1).content, 'saved');
complete({ threadId: a, attemptId: request.attemptId, modelId: model.id, modelIdentity: model.identity,
  adapterIdentities: [], content: 'saved' });
await nextTurn(); app.select(b);
assert.equal(app.getState().threads[0].attempts[0].status, 'executing', 'Terminal status is not a transient execution overlay');
saves[5].resolve(); assert.equal((await result).status, 'completed');
await app.close();
console.log('transactional workspace visibility: delayed writes, overlapping notifications and separate ephemeral execution never expose pending admission/output/terminal metadata');
