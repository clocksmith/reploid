#!/usr/bin/env node
/**
 * One short command for a native participant: `reploid <catalog model id>`.
 * It only fills in the conventional values the participant otherwise asks for
 * (state under ~/.reploid, the supported transport and GPU packages) and says
 * what it chose. The participant, its consent rules and its checks are unchanged.
 */
import { parseArgs } from 'node:util';
import { participantOptions } from './native-participant-options.js';
import { existsSync, realpathSync } from 'node:fs';
import { askMesh } from './native-node-ask.js';
import { runDoctor } from './native-node-doctor.js';
import { nativeCommand } from './native-node-commands.js';
import { supersededIds } from './native-model-names.js';
import catalog from '../shared/config/chat-models.json' with { type: 'json' };
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MODES = ['--connect-only', '--share-files', '--contribute'];
// The model `reploid` serves when no model id is given: the smallest, which most computers can run. `ask` without a
// model is not bound to it: it uses the smallest model a ready provider serves.
export const DEFAULT_MODEL = 'qwen-3-5-0-8b-q4k-ef16-af32-vf16';
// Options that only exist for partition execution; giving one keeps the participant's own default.
const PARTITION_ONLY = ['--partition-index', '--ordered-config', '--canonical', '--readiness-log'];
/** The participant arguments this command stands for. Pure, so it can be checked. */
export function nodeArguments(argv, { home, exists = existsSync, models = catalog }) {
  // Without a model id (nothing, or options only) the default model is served.
  const [model, ...rest] = argv.length && !argv[0].startsWith('-') ? argv : [DEFAULT_MODEL, ...argv];
  const given = name => rest.includes(name) || rest.some(value => value.startsWith(name + '='));
  const state = path.join(home, '.reploid');
  const args = ['--model', model];
  const chosen = {};
  if (!MODES.some(given)) { args.push('--contribute'); chosen.mode = 'contribute'; }
  const contributes = !MODES.some(given) || given('--contribute');
  const fill = (name, value) => { if (!given(name)) { args.push(name, value); chosen[name.slice(2)] = value; } };
  if (contributes && !PARTITION_ONLY.some(given)) fill('--execution-mode', 'whole-model');
  // One directory per model: catalog models share file names such as manifest.json. A model reissued under a
  // new name keeps its weights: without a directory of its own, the directory of the name it replaced is used.
  const own = path.join(state, 'weights', model);
  const earlier = supersededIds(models.find(row => row.id === model)).map(id => path.join(state, 'weights', id)).find(exists);
  fill('--model-directory', earlier && !exists(own) ? earlier : own);
  fill('--identity-file', path.join(state, 'identity.json'));
  fill('--rtc-module', '@roamhq/wrtc');
  fill('--ws-module', 'ws');
  // The participant requires a GPU provider only for compute.
  if (!given('--connect-only') && !(given('--share-files') && !given('--contribute'))) fill('--gpu-module', 'webgpu');
  return { model, args: [...args, ...rest], chosen };
}

/** The process arguments the participant parses. The entry path stays this command's: the participant
 * module starts itself when the entry path is its own file, so naming it here ran a second participant
 * after the first one stopped on SIGINT or SIGTERM. */
export function participantProcessArgv(processArgv, args) {
  return [processArgv[0], processArgv[1], ...args];
}

async function main() {
  let command;
  try { command = nativeCommand(process.argv.slice(2)); }
  catch (error) {
    console.error('reploid: ' + error.message);
    process.exitCode = 2;
    return;
  }
  if (command.text !== undefined) { console.log(command.text); return; }
  if (command.join) {
    const { runJoin } = await import('./fleet/join.js');
    try { await runJoin(command.join); }
    catch (error) { console.error('reploid: ' + error.message); process.exitCode = 1; }
    return;
  }
  if (command.doctor) {
    const result = await runDoctor(command.doctor);
    console.log(result.text);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const node = nodeArguments(command.args, { home: os.homedir() });
  if (command.prompt === undefined) console.log(JSON.stringify({ event: 'reploid-node', model: node.model, chosen: node.chosen }));
  const { mkdir } = await import('node:fs/promises');
  // The participant reads weights from an existing directory; it creates the identity's.
  const directory = parseArgs({ args: node.args, options: participantOptions }).values['model-directory'];
  if (directory) await mkdir(directory, { recursive: true });
  if (command.peerFillOnly && !existsSync(path.join(directory, 'manifest.json'))) {
    console.error('No pinned download for this model. Waiting for a weight supplier; use --weights DIRECTORY if you already have the files.');
  }
  process.argv = participantProcessArgv(process.argv, node.args);
  const { main: runParticipant } = await import('./native-participant.js');
  if (command.prompt !== undefined) {
    const response = await runParticipant({ anyModel: command.anyModel === true, runOnce: (participant, model, signal) => askMesh(participant, model, command.prompt,
      { signal, anyModel: command.anyModel === true, ...(command.execution ? { execution: command.execution } : {}) }) });
    console.log(response);
    return;
  }
  await runParticipant();
}

// npm starts a package command through a symbolic link; compare real paths.
const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) {
  try { await main(); }
  catch (error) { console.error('reploid: ' + error.message); process.exitCode = 1; }
}
