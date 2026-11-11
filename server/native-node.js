#!/usr/bin/env node
/**
 * One short command for a native participant: `reploid <catalog model id>`.
 * It only fills in the conventional values the participant otherwise asks for
 * (state under ~/.reploid, the supported transport and GPU packages) and says
 * what it chose. The participant, its consent rules and its checks are unchanged.
 */
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MODES = ['--connect-only', '--share-files', '--contribute'];
// The model `reploid` serves when no model id is given: the one public peers supply.
export const DEFAULT_MODEL = 'qwen-3-5-2b-q4k-ehaf16';
// Options that only exist for partition execution; giving one keeps the participant's own default.
const PARTITION_ONLY = ['--partition-index', '--ordered-config', '--canonical', '--readiness-log'];
const USAGE = `Reploid node (Node 22.13 or newer)
Usage: reploid [catalog model id] [participant options]

  reploid                          (same as: reploid qwen-3-5-2b-q4k-ehaf16)
  reploid qwen-3-5-2b-q4k-ehaf16

Contributes this computer's GPU for that model and runs the whole model here,
so it serves requests on its own. A model not yet on this computer is fetched
from authorized peers piece by piece (or, when no peer offers a piece, from the
model's pinned public origin), each piece and each file verified against the
catalog, into ~/.reploid/weights/<model id>; an interrupted fetch resumes.

Chosen for you unless given: --contribute, --execution-mode whole-model,
--model-directory ~/.reploid/weights/<model id>, --identity-file
~/.reploid/identity.json, --rtc-module @roamhq/wrtc, --ws-module ws,
--gpu-module webgpu. --execution-mode partition (or a partition-only option
such as --partition-index) shares the model with other contributors instead.
Pass --connect-only or --share-files to choose another mode. Every other option
goes to the participant unchanged: run reploid-participant --help for the full
list. Stop with Ctrl+C.`;

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
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); return; }
  const node = nodeArguments(argv, { home: os.homedir() });
  console.log(JSON.stringify({ event: 'reploid-node', model: node.model, chosen: node.chosen }));
  const { mkdir } = await import('node:fs/promises');
  // The participant reads weights from an existing directory; it creates the identity's.
  const directory = node.args[node.args.indexOf('--model-directory') + 1];
  if (directory) await mkdir(directory, { recursive: true });
  process.argv = participantProcessArgv(process.argv, node.args);
  const { main: runParticipant } = await import('./native-participant.js');
  await runParticipant();
}

// npm starts a package command through a symbolic link; compare real paths.
const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) await main();
