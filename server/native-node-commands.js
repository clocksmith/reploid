import { readHostMemory } from './native-node-doctor.js';
import { readFileSync } from 'node:fs';
import { resolveServedFile } from './browser-roots.js';
import { sha256Digest } from './hashing.js';
import { parseArgs } from 'node:util';
import catalog from '../shared/config/chat-models.json' with { type: 'json' };
import { resolvePinnedOrigin } from './native-model-origin.js';
import { findCatalogModel } from './native-model-names.js';
import { participantHelp, participantOptions } from './native-participant-options.js';
import { shellCompletion } from './native-node-completion.js';
import { askExecution } from './native-node-ask.js';

const commands = {
  ask: 'Send one prompt to a ready mesh provider',
  serve: 'Serve a whole model on this GPU',
  split: 'Serve one stage of a model with another computer',
  connect: 'Join discovery without offering compute or files',
  share: 'Supply verified model files without running inference',
  models: 'List models included in this installation',
  doctor: 'Check this computer and signaling',
  completion: 'Print tab completion for Bash, Zsh or Fish',
};
const shortNames = {
  'qwen-3-5-0-8b-q4k-ef16-af32-vf16': '0.8b',
  'qwen-3-5-2b-q4k-ef16-af32': '2b',
  'qwen-3-8-27b-text-q4k-ef16-af32': '27b',
  'qwen-3-6-35b-a3b-text-source-q40-hq6k-af32': '35b',
  'qwen-3-8-flash-next-177b-text-source-q40-hq80-af32': 'flash',
};
const canSplit = model => !model.executionModes || model.executionModes.includes('partition');
const modelNames = models => models.flatMap(m => [shortNames[m.id], m.id].filter(Boolean));
const askOptions = ['model', 'model-config', 'ordered-config', 'room', 'room-token-file', 'rtc-config-file', 'signaling-url', 'origin', 'identity-file'];
// Execution requirements for ask. They configure the inference request, never the participant process.
const askExecutionOptions = { participant: { type: 'string', multiple: true }, confidentiality: { type: 'string' }, 'allow-metadata': { type: 'string' } };
const doctorOptions = ['origin', 'signaling-url'];
const subset = names => Object.fromEntries(names.map(name => [name, participantOptions[name]]));
const commandNames = [...Object.keys(commands), 'help'];
const help = `Reploid · share this computer with an inference network

  npx reploid models             See models and where to get their weights
  npx reploid serve 2b           Serve the default 2B model on your GPU
  npx reploid ask 2b "Hello"     Ask a provider without downloading weights

${Object.entries(commands).map(([name, description]) => '  ' + name.padEnd(13) + description).join('\n')}

Run “npx reploid help split” for private-room setup or “npx reploid help options”
for all participant flags. With no arguments, Reploid serves the default 2B
model in the public room. Model files are stored under ~/.reploid/weights.
Press Ctrl+C to stop.`;
const details = {
  ask: `npx reploid ask [model] "Your question"
Send one ordinary request. The selected provider can read the prompt. Defaults to 2B and the public room. Private room options: --room reploid-swarm-NAME --room-token-file PATH --signaling-url URL.
Execution: --participant ID (repeatable) limits who may read the prompt; --allow-metadata model-id,timing,length lists the metadata the route may expose;
--confidentiality requester-only asks that no executor can read the prompt. No backend qualifies for that yet, so it is refused before anything is sent.`,
  doctor: 'npx reploid doctor [--signaling-url URL] [--origin URL]\nCheck Node, host RAM, the installed Doppler version, GPU adapter and signaling connectivity.',
  serve: 'npx reploid serve [model] [--weights DIRECTORY]\nServe the whole model. Missing weights can come from authorized peers or a pinned origin.',
  split: `npx reploid split <model> --stage 0|1 [--weights DIRECTORY]
Start one contributor on each computer, using a different stage on each.
For a private room, pass these options on both computers and the requester:
  --room reploid-swarm-NAME --signaling-url URL --room-token-file /absolute/path/to/token
Use a token file owned by you with mode 0600. Both stages and a requester are needed to answer.`,
  connect: 'npx reploid connect [model] [--room reploid-swarm-NAME]\nJoin discovery without starting a GPU or sharing files.',
  share: 'npx reploid share [model] [--weights DIRECTORY] [--supply-limit-gib GiB] [--supply-to COMPUTER_ID]\nOffer verified files to room peers. Repeat --supply-to to restrict uploads to named computers.',
  models: 'npx reploid models\nList the bundled model IDs, shortcuts, supported modes and whole-model weight sources.',
  completion: `npx reploid completion bash|zsh|fish
Enable Tab for reploid and npx reploid in the current shell:
  source <(npx reploid completion zsh)
In Zsh, initialize compinit first. For Bash:
  npx reploid completion bash > ~/.reploid-completion.bash
  source ~/.reploid-completion.bash
For Fish: npx reploid completion fish | source`,
  options: participantHelp,
};

function modelList() {
  const { totalBytes, availableBytes } = readHostMemory();
  const rows = catalog.map(m => {
    const origin = resolvePinnedOrigin(m) ? 'peer, local files, or pinned download' : 'peer or local files';
    const manifestFile = m.source.files.find(file => file.role === 'model-manifest');
    if (manifestFile?.hashAlgorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(manifestFile.hash)
      || manifestFile.url !== `/config/model-manifests/${manifestFile.hash}.json`) {
      throw new Error(`Missing bundled manifest for ${m.id}`);
    }
    const manifestBytes = readFileSync(resolveServedFile(manifestFile.url, { roots: ['shared'] }));
    if (sha256Digest(manifestBytes) !== m.identity || m.identity !== 'sha256:' + manifestFile.hash) {
      throw new Error(`Bundled manifest differs from the approved catalog for ${m.id}`);
    }
    const manifest = JSON.parse(manifestBytes);
    // The piece index covers the weight shards and tokenizer. Both sizes are already pinned locally.
    const tokenizer = m.source.files.find(file => file.role === 'tokenizer');
    if (manifest.modelId !== m.id || !Number.isSafeInteger(manifest.totalSize) || manifest.totalSize <= 0
      || !Number.isSafeInteger(tokenizer?.sizeBytes) || tokenizer.sizeBytes <= 0) {
      throw new Error(`Missing model file sizes for ${m.id}`);
    }
    const bytes = manifest.totalSize + tokenizer.sizeBytes;
    const gb = bytes / 1e9;
    const budget = m.loadOptions?.runtimeConfig?.shared?.bufferPool?.budget?.maxTotalBytes;
    let fit = 'files within available RAM';
    if (bytes > totalBytes) fit = 'files exceed host RAM';
    else if (bytes > availableBytes) fit = 'files exceed available RAM';
    else if (budget > availableBytes) fit = 'buffer cap exceeds available RAM';
    return [shortNames[m.id] || '-', m.id, gb.toFixed(1), canSplit(m) ? 'solo/split' : 'solo', origin, fit];
  });
  rows.unshift(['SHORT', 'MODEL ID', 'GB of files', 'SERVING', 'WEIGHT SOURCES', 'SOLO RAM ESTIMATE']);
  const widths = rows[0].map((_, i) => Math.max(...rows.map(row => row[i].length)));
  const table = rows.map(row => row.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd()).join('\n');
  return table + `\n\nHost RAM: ${(availableBytes / 2 ** 30).toFixed(1)} GiB available of ${(totalBytes / 2 ** 30).toFixed(1)} GiB. Figures compare files and any configured buffer cap with host RAM. Actual fit depends on GPU memory, context and runtime overhead.`;

}

export function nativeCommand(argv) {
  const [first, ...rest] = argv;
  const command = Object.hasOwn(commands, first) ? first : null;
  const optionsEnd = argv.indexOf('--');
  const beforeTerminator = optionsEnd < 0 ? argv : argv.slice(0, optionsEnd);
  if (first === 'help' || beforeTerminator.includes('--help') || beforeTerminator.includes('-h')) {
    const topic = first === 'help' ? rest[0] : command;
    if (!topic || topic === 'help') return { text: help };
    if (!Object.hasOwn(details, topic)) throw Error(`Unknown help topic "${topic}". Try reploid --help.`);
    return { text: details[topic] };
  }
  if (command === 'models') {
    if (rest.length) throw Error(details.models);
    return { text: modelList() };
  }
  if (command === 'completion') {
    if (rest.length !== 1 || !['bash', 'zsh', 'fish'].includes(rest[0])) throw Error(details.completion);
    return { text: shellCompletion(rest[0], { askFlags: [...askOptions, ...Object.keys(askExecutionOptions)].map(k => '--' + k).concat('--help'),
      doctorFlags: [...doctorOptions.map(k => '--' + k), '--help'], commands: commandNames, models: modelNames(catalog),
      splitModels: modelNames(catalog.filter(canSplit)), flags: Object.keys(participantOptions).map(k => '--' + k) }) };
  }
  if (command === 'doctor') {
    const { values } = parseArgs({ args: rest, options: subset(doctorOptions) });
    return { doctor: { signalingUrl: values['signaling-url'], origin: values.origin } };
  }
  const { values, positionals, tokens } = parseArgs({ args: command ? rest : argv, allowPositionals: true, tokens: true,
    options: command === 'ask' ? { ...subset(askOptions), ...askExecutionOptions } : { ...participantOptions, weights: { type: 'string' }, stage: { type: 'string' } } });
  const prompt = command === 'ask' ? positionals.pop() : undefined;
  if (command === 'ask' && !prompt?.trim()) throw Error(details.ask);
  if (positionals.length > 1 || (positionals.length && values.model)) throw Error('Choose one model. Run reploid models for available names.');
  const name = positionals[0] ?? values.model;
  const model = name === undefined ? undefined : catalog.find(m => m.id === name || shortNames[m.id] === name) ?? findCatalogModel(catalog, name);
  if (name !== undefined && !model && !values['model-config']) throw Error(`Unknown model or command "${name}". Run reploid models for this installation.`);
  if (values.weights !== undefined && values['model-directory'] !== undefined) throw Error('Choose --weights or --model-directory once.');
  if (values.stage !== undefined && (command !== 'split' || values['partition-index'] !== undefined)) throw Error('Use --stage with split, in place of --partition-index.');
  const stage = values.stage ?? values['partition-index'];
  if (command === 'split' && (!name || !['0', '1'].includes(stage))) throw Error(details.split);
  if (command === 'split' && model && !canSplit(model) && !values['model-config']) throw Error(`${model.name} supports whole-model serving only. Try reploid serve ${name}.`);
  const modes = { ask: ['--connect-only'], serve: ['--contribute', '--execution-mode', 'whole-model'], split: ['--contribute', '--execution-mode', 'partition'],
    connect: ['--connect-only'], share: ['--share-files'] };
  if (command && ['connect-only', 'share-files', 'contribute', 'execution-mode'].some(k => values[k])) {
    throw Error(`The ${command} command selects its mode. Use a model ID followed by flags to combine modes.`);
  }
  if (name !== undefined && (!name || name.startsWith('-') || /[/\\]/.test(name) || ['.', '..'].includes(name))) {
    throw Error('Expected a model ID. Use --weights to select a directory.');
  }
  const args = name !== undefined ? [model?.id ?? name] : [];
  if (command) args.push(...modes[command]);
  for (const token of tokens) {
    if (token.kind !== 'option' || token.name === 'model' || (command === 'ask' && Object.hasOwn(askExecutionOptions, token.name))) continue;
    const key = { weights: 'model-directory', stage: 'partition-index' }[token.name] ?? token.name;
    if (token.inlineValue) args.push(`--${key}=${token.value}`);
    else {
      args.push('--' + key);
      if (token.value !== undefined) args.push(token.value);
    }
  }
  if (command === 'serve' && model && !values['model-config'] && !resolvePinnedOrigin(model)) return { args, peerFillOnly: true };
  if (prompt === undefined) return { args };
  const execution = values.participant || values.confidentiality || values['allow-metadata'] !== undefined
    ? askExecution({ participants: values.participant ?? [], confidentiality: values.confidentiality, allowMetadata: values['allow-metadata'] }) : undefined;
  return execution ? { args, prompt, execution } : { args, prompt };
}
