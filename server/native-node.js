#!/usr/bin/env node
/**
 * One short command for a native participant: `reploid <catalog model id>`.
 * It only fills in the conventional values the participant otherwise asks for
 * (state under ~/.reploid, the supported transport and GPU packages) and says
 * what it chose. The participant, its consent rules and its checks are unchanged.
 */
import { parseArgs } from 'node:util';
import { participantOptions } from './native-participant-options.js';
import { realpathSync } from 'node:fs';
import { nativeCommand } from './native-node-commands.js';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MODES = ['--connect-only', '--share-files', '--contribute'];
// The model `reploid` serves when no model id is given: the one public peers supply.
export const DEFAULT_MODEL = 'qwen-3-5-2b-q4k-ehaf16';
// Options that only exist for partition execution; giving one keeps the participant's own default.
const PARTITION_ONLY = ['--partition-index', '--ordered-config', '--canonical', '--readiness-log'];
/** The participant arguments this command stands for. Pure, so it can be checked. */
export function nodeArguments(argv, { home }) {
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
  // One directory per model: catalog models share file names such as manifest.json.
  fill('--model-directory', path.join(state, 'weights', model));
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
  const node = nodeArguments(command.args, { home: os.homedir() });
  console.log(JSON.stringify({ event: 'reploid-node', model: node.model, chosen: node.chosen }));
  const { mkdir } = await import('node:fs/promises');
  // The participant reads weights from an existing directory; it creates the identity's.
  const directory = parseArgs({ args: node.args, options: participantOptions }).values['model-directory'];
  if (directory) await mkdir(directory, { recursive: true });
  process.argv = participantProcessArgv(process.argv, node.args);
  const { main: runParticipant } = await import('./native-participant.js');
  await runParticipant();
}

// npm starts a package command through a symbolic link; compare real paths.
const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) await main();
