#!/usr/bin/env node
/**
 * The web client's real export and import code, for checking another client's
 * data files against it (procedures.localDataExport).
 *
 *   node local-data-check.js emit          writes a real web export to stdout
 *   node local-data-check.js check <file>  imports the file into a fresh web
 *                                          workspace and prints what it holds
 *
 * Nothing is sent anywhere: the workspace's model is a stub.
 */
import fs from 'node:fs/promises';
import { createChatWorkspace } from '../../../packages/reploid/src/chat/workspace.js';
import { createLocalData } from '../../../apps/poolday/host/local-data.js';
import { createComputerPreferences } from '../../../apps/poolday/host/computer-preferences.js';
import { attachmentInput } from '../../../apps/poolday/host/document-comparison.js';

const MODEL = { id: 'model-a', name: 'Model A', identity: `sha256:${'a'.repeat(64)}` };
const PEER = 'peer:0123456789abcdef01234567';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key) };
}

function open() {
  let data;
  const execute = async request => {
    const asked = request.messages.at(-1).content;
    if (asked === 'fail this one') throw new Error('stub failure');
    return { threadId: request.threadId, attemptId: request.attemptId, modelId: request.model.id,
      modelIdentity: request.model.identity, adapterIdentities: [], content: `Answer to: ${asked.slice(0, 12)}` };
  };
  const workspace = createChatWorkspace({ meshId: 'local-data-check', participantId: 'peer:aaaaaaaaaaaaaaaaaaaaaaaa',
    store: { load: () => data, save: value => { data = structuredClone(value); } }, execute });
  const chat = { exportThreads: () => ({ meshId: 'local-data-check', participantId: 'peer:aaaaaaaaaaaaaaaaaaaaaaaa',
    threads: structuredClone(workspace.getState().threads) }),
    importThreads: (threads, options) => workspace.importThreads(threads, options) };
  const computers = createComputerPreferences({ storage: memoryStorage() });
  return { workspace, computers, data: createLocalData({ chat, computers }) };
}

async function emit() {
  const { workspace, computers, data } = open();
  const first = workspace.createThread({ model: MODEL, purpose: '', permissions: { sharingScope: 'mesh', executionLocation: 'network' } });
  await workspace.send(first, 'What is a prime?');
  await workspace.send(first, attachmentInput('Summarize this', [{ name: 'notes.txt', text: 'One.\n\nTwo.' }]));
  const second = workspace.createThread({ model: MODEL, purpose: '', permissions: { sharingScope: 'mesh', executionLocation: 'network' } });
  await workspace.send(second, 'fail this one').catch(() => {});
  computers.importPreferences({ names: { [PEER]: 'Workbench' }, blocked: ['peer:fedcba9876543210fedcba98'] });
  process.stdout.write(JSON.stringify(data.export()));
  await workspace.close();
}

async function check(file) {
  const { workspace, computers, data } = open();
  const plan = data.plan(await fs.readFile(file, 'utf8'));
  const done = plan.apply();
  const preferences = computers.getState();
  process.stdout.write(JSON.stringify({ ok: true, done, summary: plan.summary,
    conversations: workspace.getState().threads.map(thread => ({ id: thread.id, title: thread.title ?? null, model: thread.model.id,
      messages: thread.messages.map(message => ({ role: message.role, content: message.content, status: message.status })),
      attempts: thread.attempts.map(attempt => ({ id: attempt.id, status: attempt.status, responseId: attempt.responseId ?? null })) })),
    names: preferences.names, blocked: preferences.blocked }));
  await workspace.close();
}

const [command, file] = process.argv.slice(2);
try {
  if (command === 'emit') await emit();
  else if (command === 'check' && file) await check(file);
  else throw new Error('Usage: local-data-check.js emit | check <file>');
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}
