#!/usr/bin/env node
import { existsSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import catalog from '../shared/config/chat-models.json' with { type: 'json' };
import { renderCompletion } from './native-node-completion.js';

const MODES = ['--connect-only', '--share-files', '--contribute'];
export const DEFAULT_MODEL = 'qwen-3-5-2b-q4k-ehaf16';
const PARTITION_ONLY = ['--partition-index', '--ordered-config', '--canonical', '--readiness-log'];
const MODEL_ALIASES = new Map([
  ['0.8b', 'qwen-3-5-0-8b-q4k-ehaf16'],
  ['2b', DEFAULT_MODEL],
  ['27b', 'qwen3-8-27b-text-q4k-ehaf16'],
  ['35b', 'qwen-3-6-35b-a3b-text-source-q4_0-af32'],
]);
const OPTION_ALIASES = new Map([
  ['--weights', '--model-directory'],
  ['--signaling', '--signaling-url'],
  ['--stage', '--partition-index'],
]);
const MODEL_OPTIONS = '--weights --room --signaling --room-token-file';
const COMMANDS = {
  models: { synopsis: 'models [--json]', summary: 'List models in this installation.' },
  ask: { synopsis: 'ask [model] "<prompt>"', summary: 'Ask a model in a Reploid room.',
    options: '--room --signaling --room-token-file --yes' },
  serve: { synopsis: 'serve [model]', summary: 'Start a local OpenAI-compatible server.', options: '--weights --port' },
  contribute: { synopsis: 'contribute [model]', summary: 'Serve a whole model to the mesh.', options: MODEL_OPTIONS },
  split: { synopsis: 'split <model> --stage <0|1>', summary: 'Serve one stage of a split model.',
    options: `${MODEL_OPTIONS} --stage --model-config --ordered-config` },
  doctor: { synopsis: 'doctor [--json]', summary: 'Check Node, memory, WebGPU, signaling, and Doppler.',
    options: '--json --room --signaling' },
  completion: { synopsis: 'completion <zsh|bash|fish>', summary: 'Print shell completion for reploid and npx reploid.' },
  help: { synopsis: 'help [command]', summary: 'Show command help.' },
};
const MODEL_ROWS = catalog.map(model => ({
  id: model.id,
  aliases: [...MODEL_ALIASES].filter(([, id]) => id === model.id).map(([alias]) => alias),
  name: model.name,
  size: model.size,
  modes: model.executionModes ?? ['whole-model', 'partition'],
}));

const USAGE = `Reploid native participant (Node 22.13 or newer)
Usage: npx reploid <command> [options]

${Object.values(COMMANDS).map(({ synopsis, summary }) => `  ${synopsis.padEnd(29)} ${summary}`).join('\n')}

Examples
  npx reploid models
  npx reploid ask 2b "Count to five."
  npx reploid serve 27b --weights ~/models/27b
  eval "$(npx reploid completion zsh)"

Bare npx reploid still serves ${DEFAULT_MODEL} on the public mesh.
The legacy form npx reploid <model> [participant options] also works.
Use npx reploid help contribute for private-room options. Stop serving with Ctrl+C.`;

const NETWORK_HELP = `  --weights <directory>      Use this model directory (default ~/.reploid/weights/<id>).
  --room <name>              Select a room. The default joins public discovery.
  --signaling <ws-url>        Use an explicit signaling endpoint.
  --room-token-file <file>   Use an absolute path to a private room's 0600 token file.

For a private deployment, specify its signaling endpoint, room and token file.
Use the same room configuration on every host and the requester. Advanced
participant flags are also accepted. See reploid-participant --help.`;

const HELP = {
  models: `Usage: npx reploid models [--json]\n\nLists packaged models, weight sources and execution modes. RAM fit is an\nestimate with a 4 GiB runtime allowance. Live headroom, GPU limits and the\ncontext length still affect whether a model loads.`,
  ask: `Usage: npx reploid ask [model] "<prompt>" [--yes]\n\nUse a ready route without loading weights. The default model is 2b. Review\nthe selected recipients before the prompt is sent. Use --yes to approve the\nfirst eligible route non-interactively.\n\n${NETWORK_HELP}`,
  serve: `Usage: npx reploid serve [model] [--weights <directory>] [--port <number>]\n\nServe a model on this computer at http://127.0.0.1:11434/v1. The default model\nis 2b. Missing weights download from the pinned origin when one exists. For\nother models supply the complete RDRR directory. This command joins no room.`,
  contribute: `Usage: npx reploid contribute [model] [options]\n\nServe a whole model on the mesh. The default is 2b. Missing weights use\nverified peer pieces or a pinned origin when one exists.\n\n${NETWORK_HELP}`,
  split: `Usage: npx reploid split <model> --stage <0|1> [options]\n\nRun this command on each host with a different stage. Use --ordered-config\nfor an explicit ordered stage and --model-config for a custom private plan.\n\n${NETWORK_HELP}`,
  doctor: 'Usage: npx reploid doctor [--signaling <ws-url>] [--room <name>] [--json]',
  completion: `Usage: npx reploid completion <zsh|bash|fish>\n\nEnable completion for the current shell (after compinit for zsh).\n  eval "$(npx reploid completion zsh)"\n  eval "$(npx reploid completion bash)"\n  npx reploid completion fish | source`,
  help: 'Usage: npx reploid help [command]',
};

function catalogModel(id) {
  const model = catalog.find(row => row.id === id);
  if (!model) throw new Error(`Model ${id} is absent from this installation. Run reploid models.`);
  return model;
}

function optionIndex(args, name) {
  return args.findLastIndex(arg => arg === name || arg.startsWith(`${name}=`));
}

function optionValue(args, name) {
  const index = optionIndex(args, name);
  if (index === -1) return undefined;
  const arg = args[index];
  const value = arg === name ? args[index + 1] : arg.slice(name.length + 1);
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

/** The participant arguments this command stands for. Pure, so it can be checked. */
export function nodeArguments(argv, { home }) {
  const command = ['contribute', 'split'].includes(argv[0]) ? argv[0] : null;
  const input = command ? argv.slice(1) : argv;
  const [position, ...options] = input.length && !input[0].startsWith('-') ? input : [undefined, ...input];
  const rest = options.map(arg => {
    const name = arg.split('=', 1)[0];
    return (OPTION_ALIASES.get(name) ?? name) + arg.slice(name.length);
  });
  const given = name => optionIndex(rest, name) !== -1;
  const namedModel = optionValue(rest, '--model');
  const requestedModel = namedModel ?? position ?? DEFAULT_MODEL;
  const model = MODEL_ALIASES.get(requestedModel) ?? requestedModel;
  if (namedModel !== undefined) {
    const index = optionIndex(rest, '--model');
    rest.splice(index, rest[index] === '--model' ? 2 : 1, '--model', model);
  }
  const mode = optionValue(rest, '--execution-mode');
  if (command && given('--connect-only')) {
    throw new Error(`Use reploid --connect-only without ${command} to discover providers`);
  }
  if (command === 'contribute' && (mode === 'partition' || PARTITION_ONLY.some(given))) {
    throw new Error('Use reploid split for partition options');
  }
  if (command === 'split') {
    if (!position && !namedModel) throw new Error('Choose a model with reploid split <model>');
    if (mode && mode !== 'partition') throw new Error('reploid split requires partition execution');
    const stage = optionValue(rest, '--partition-index');
    const ordered = given('--ordered-config');
    if (!stage && !ordered || stage && (ordered || !['0', '1'].includes(stage))) {
      throw new Error('Choose --stage 0 or --stage 1, or supply --ordered-config');
    }
    if (!given('--model-config') && !MODEL_ROWS.find(row => row.id === model)?.modes.includes('partition')) {
      throw new Error(`${model} has no built-in split plan. Use --model-config for a private plan.`);
    }
  }
  const state = path.join(home, '.reploid');
  const args = namedModel === undefined ? ['--model', model] : [];
  const chosen = {};
  const contributes = Boolean(command) || !MODES.some(given) || given('--contribute');
  if (contributes && !given('--contribute')) { args.push('--contribute'); chosen.mode = 'contribute'; }
  const fill = (name, value) => { if (!given(name)) { args.push(name, value); chosen[name.slice(2)] = value; } };
  if (command === 'split') fill('--execution-mode', 'partition');
  else if (contributes && !PARTITION_ONLY.some(given)) fill('--execution-mode', 'whole-model');
  // One directory per model: catalog models share file names such as manifest.json.
  if (!given('--model-directory') && (model !== path.basename(model) || ['.', '..'].includes(model))) {
    throw new Error('Specify --weights for a model ID that is not a directory name');
  }
  fill('--model-directory', path.join(state, 'weights', model));
  fill('--identity-file', path.join(state, 'identity.json'));
  fill('--rtc-module', '@roamhq/wrtc');
  fill('--ws-module', 'ws');
  // The participant requires a GPU provider only for compute.
  if (contributes && !given('--connect-only')) fill('--gpu-module', 'webgpu');
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
  const [command, argument, ...extra] = argv;
  const separator = argv.indexOf('--');
  if (command === 'help') {
    if (extra.length || argument && !Object.hasOwn(HELP, argument)) throw new Error('See reploid --help for available commands');
    console.log(argument ? HELP[argument] : USAGE);
    return;
  }
  if ((separator === -1 ? argv : argv.slice(0, separator)).some(arg => arg === '--help' || arg === '-h')) {
    console.log(Object.hasOwn(HELP, command) ? HELP[command] : USAGE);
    return;
  }
  if (command === 'models') {
    if (extra.length || argument && argument !== '--json') throw new Error(HELP.models);
    const { modelSizing, gib } = await import('./native-node-info.js');
    const rows = await Promise.all(MODEL_ROWS.map(async row => ({ ...row, ...await modelSizing(catalogModel(row.id)) })));
    if (argument === '--json') console.log(JSON.stringify(rows, null, 2));
    else {
      console.log('Model   Weights    RAM fit¹   Execution      Weight source');
      for (const row of rows) {
        const fit = row.estimatedRamFit === null ? 'unknown' : row.estimatedRamFit ? 'likely' : 'unlikely';
        const modes = row.modes.map(mode => mode === 'partition' ? 'split' : 'solo').join(' / ');
        const source = row.weightSources.includes('pinned-origin') ? 'auto-download' : 'peer or --weights';
        const size = row.weightBytes === null ? 'unknown' : gib(row.weightBytes);
        console.log(`${(row.aliases.join(', ') || '–').padEnd(7)} ${size.padEnd(10)} ${fit.padEnd(10)} ${modes.padEnd(14)} ${source}`);
        console.log(`        ${row.id}`);
      }
      console.log(`\n¹ Estimate from ${gib(os.totalmem())} total RAM and a 4 GiB runtime allowance. See reploid doctor for current headroom.`);
    }
    return;
  }
  if (command === 'doctor') {
    const { doctor } = await import('./native-node-info.js');
    if (!await doctor(argv.slice(1))) process.exitCode = 1;
    return;
  }
  if (command === 'serve') {
    const { values, positionals } = parseArgs({ args: argv.slice(1), allowPositionals: true,
      options: { weights: { type: 'string' }, port: { type: 'string' } } });
    if (positionals.length > 1) throw new Error(HELP.serve);
    const alias = positionals[0] ?? '2b';
    const model = catalogModel(MODEL_ALIASES.get(alias) ?? alias);
    const port = Number(values.port ?? 11434);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('Choose a port from 1 to 65535');
    const { serveLocalModel } = await import('./native-node-local.js');
    await serveLocalModel({ model, alias, port,
      modelDirectory: values.weights ?? path.join(os.homedir(), '.reploid', 'weights', model.id) });
    return;
  }
  if (command === 'completion') {
    if (extra.length || !['zsh', 'bash', 'fish'].includes(argument)) throw new Error(HELP.completion);
    const options = Object.fromEntries(Object.entries(COMMANDS).map(([name, spec]) => [name, spec.options || '']));
    console.log(renderCompletion(argument, { options, models: MODEL_ROWS, legacyOptions: MODEL_OPTIONS }));
    return;
  }
  const ask = command === 'ask' ? await import('./native-node-ask.js') : null;
  const parsed = ask?.parseAsk(argv.slice(1));
  if (parsed && !parsed.yes && !process.stdin.isTTY) throw new Error('Use --yes to approve disclosure in a non-interactive shell');
  const node = nodeArguments(parsed?.participantArgs ?? argv, { home: os.homedir() });
  if (!MODEL_ROWS.some(row => row.id === node.model) && optionIndex(node.args, '--model-config') === -1) {
    throw new Error(`Unknown model ${node.model}. Run reploid models to list what's installed.`);
  }
  const directory = optionValue(node.args, '--model-directory');
  const { main: runParticipant } = await import('./native-participant.js');
  if (parsed) {
    process.argv = participantProcessArgv(process.argv, node.args);
    const answer = await runParticipant({ requestOnce: ask.askOnce({ ...parsed, confirm: parsed.yes ? null : ask.confirmRecipients }) });
    console.log(answer.content);
    if (answer.receiptId) console.error(`Receipt ${answer.receiptId}`);
    return;
  }
  if (command === 'contribute' && !existsSync(path.join(directory, 'manifest.json'))) {
    const { resolvePinnedOrigin } = await import('./native-model-origin.js');
    if (!resolvePinnedOrigin(catalog.find(row => row.id === node.model))) {
      console.error(`No pinned download for ${node.model}. Supply --weights or wait for an authorized peer with its files.`);
    }
  }
  console.log(JSON.stringify({ event: 'reploid-node', model: node.model, chosen: node.chosen }));
  const { mkdir } = await import('node:fs/promises');
  // The participant reads weights from an existing directory; it creates the identity's.
  await mkdir(directory, { recursive: true });
  process.argv = participantProcessArgv(process.argv, node.args);
  await runParticipant();
}

// npm starts a package command through a symbolic link; compare real paths.
const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) {
  try { await main(); }
  catch (error) {
    console.error(`reploid: ${error.message}`);
    process.exitCode = 1;
  }
}
