import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import catalog from '../shared/config/chat-models.json' with { type: 'json' };
import { resolvePinnedOrigin } from './native-model-origin.js';
import { participantHelp, participantOptions } from './native-participant-options.js';
import { shellCompletion } from './native-node-completion.js';

const commands = {
  serve: 'Serve a whole model on this GPU',
  split: 'Serve one stage of a model with another computer',
  connect: 'Join discovery without offering compute or files',
  share: 'Supply verified model files without running inference',
  models: 'List models included in this installation',
  completion: 'Print tab completion for Bash or Zsh',
};
const shortNames = {
  'qwen-3-5-0-8b-q4k-ehaf16': '0.8b',
  'qwen-3-5-2b-q4k-ehaf16': '2b',
  'qwen3-8-27b-text-q4k-ehaf16': '27b',
  'qwen-3-6-35b-a3b-text-source-q4_0-af32': '35b',
};
const canSplit = model => !model.executionModes || model.executionModes.includes('partition');
const modelNames = models => models.flatMap(m => [shortNames[m.id], m.id].filter(Boolean));
const commandNames = [...Object.keys(commands), 'help'];
const help = `Reploid · share this computer with an inference network

  npx reploid models             See models and where to get their weights
  npx reploid serve 2b           Serve the default 2B model on your GPU
  npx reploid connect            Discover peers without contributing

${Object.entries(commands).map(([name, description]) => '  ' + name.padEnd(13) + description).join('\n')}

Run “npx reploid help split” for private-room setup or “npx reploid help options”
for all participant flags. With no arguments, Reploid serves the default 2B
model in the public room. Model files are stored under ~/.reploid/weights.
Press Ctrl+C to stop.`;
const details = {
  serve: 'npx reploid serve [model] [--weights DIRECTORY]\nServe the whole model. Missing weights can come from authorized peers or a pinned origin.',
  split: `npx reploid split <model> --stage 0|1 [--weights DIRECTORY]
Start one contributor on each computer, using a different stage on each.
For a private room, pass these options on both computers and the requester:
  --room NAME --signaling-url URL --room-token-file /absolute/path/to/token
Use a token file owned by you with mode 0600. Both stages and a requester are needed to answer.`,
  connect: 'npx reploid connect [model] [--room NAME]\nJoin discovery without starting a GPU or sharing files.',
  share: 'npx reploid share [model] [--weights DIRECTORY]\nOffer existing verified model files to authorized peers. No compute is offered.',
  models: 'npx reploid models\nList the bundled model IDs, shortcuts, supported modes and whole-model weight sources.',
  completion: `npx reploid completion bash|zsh
Enable Tab for reploid and npx reploid in the current shell:
  source <(npx reploid completion zsh)
In Zsh, initialize compinit first. For Bash:
  npx reploid completion bash > ~/.reploid-completion.bash
  source ~/.reploid-completion.bash`,
  options: participantHelp,
};

function modelList() {
  return catalog.map(m => {
    const origin = resolvePinnedOrigin(m) ? 'peer, local files, or pinned download' : 'peer or local files';
    const indexFile = m.source.files.find(file => file.role === 'model-piece-index');
    const index = JSON.parse(readFileSync(new URL('../shared' + indexFile.url, import.meta.url), 'utf8'));
    const gb = index.files.reduce((sum, file) => sum + file.size, 0) / 1e9;
    return `${shortNames[m.id] || m.id}  ${m.name}  |  ${gb.toFixed(1)} GB of files  |  ${canSplit(m) ? 'whole or split' : 'whole only'}  |  ${origin}\n  ${m.id}`;
  }).join('\n');
}

export function nativeCommand(argv) {
  const [first, ...rest] = argv;
  const command = Object.hasOwn(commands, first) ? first : null;
  if (first === 'help' || argv.includes('--help') || argv.includes('-h')) {
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
    if (rest.length !== 1 || !['bash', 'zsh'].includes(rest[0])) throw Error(details.completion);
    return { text: shellCompletion(rest[0], { commands: commandNames, models: modelNames(catalog),
      splitModels: modelNames(catalog.filter(canSplit)), flags: Object.keys(participantOptions).map(k => '--' + k) }) };
  }
  const { values, positionals, tokens } = parseArgs({ args: command ? rest : argv, allowPositionals: true, tokens: true,
    options: { ...participantOptions, weights: { type: 'string' }, stage: { type: 'string' } } });
  if (positionals.length > 1 || (positionals.length && values.model)) throw Error('Choose one model. Run reploid models for available names.');
  const name = positionals[0] ?? values.model;
  const model = name === undefined ? undefined : catalog.find(m => m.id === name || shortNames[m.id] === name);
  if (name !== undefined && !model && !values['model-config']) throw Error(`Unknown model or command "${name}". Run reploid models for this installation.`);
  if (values.weights !== undefined && values['model-directory'] !== undefined) throw Error('Choose --weights or --model-directory once.');
  if (values.stage !== undefined && (command !== 'split' || values['partition-index'] !== undefined)) throw Error('Use --stage with split, in place of --partition-index.');
  const stage = values.stage ?? values['partition-index'];
  if (command === 'split' && (!name || !['0', '1'].includes(stage))) throw Error(details.split);
  if (command === 'split' && model && !canSplit(model) && !values['model-config']) throw Error(`${model.name} supports whole-model serving only. Try reploid serve ${name}.`);
  const modes = { serve: ['--contribute', '--execution-mode', 'whole-model'], split: ['--contribute', '--execution-mode', 'partition'],
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
    if (token.kind !== 'option' || token.name === 'model') continue;
    const key = { weights: 'model-directory', stage: 'partition-index' }[token.name] ?? token.name;
    if (token.inlineValue) args.push(`--${key}=${token.value}`);
    else {
      args.push('--' + key);
      if (token.value !== undefined) args.push(token.value);
    }
  }
  return { args };
}
