// Application text path for the useful-answer runs, without any GPU.
//
// Uses the same Doppler 0.6.28 archive (sha256:2df37d88...) as ../answer-cause-20261014:
//   - formatChatMessages(messages, 'qwen', undefined): the resident tokenize path
//     (model-session.js tokenizePrompt) with the Capsule manifest's chatTemplate
//     {type: qwen, enabled: true, thinking: false};
//   - the bundled Tokenizer initialized from the Capsule's own tokenizer.json;
//   - tokenizer.createIncrementalDecoder(), pushed one token at a time and finished with
//     the stop reason, exactly as resident-partition.js builds the delivered text. The
//     manifest has no reasoningOutput, so createGenerationOutputDecoder returns this
//     plain decoder.
//
// Protocol: one JSON request per stdin line, one JSON response per stdout line.
//   {"op":"render","messages":[...]}            -> {"ok":true,"text":...,"ids":[...]}
//   {"op":"decode","ids":[...],"stopReason":s}  -> {"ok":true,"text":...}
// Doppler's console logging is redirected to stderr so stdout carries only responses.
//
// Usage: node doppler-text.mjs <doppler package root> <capsule dir>
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

for (const name of ['log', 'info', 'debug', 'warn']) {
  console[name] = (...args) => process.stderr.write(args.map(String).join(' ') + '\n');
}

const [packageRoot, capsuleDir] = process.argv.slice(2);
if (!capsuleDir) throw new Error('Usage: doppler-text.mjs PACKAGE CAPSULE');
const mod = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
const [{ Tokenizer }, { formatChatMessages }, { DOPPLER_VERSION }] = await Promise.all([
  mod('inference/tokenizer.js'), mod('inference/pipelines/text/chat-format.js'), mod('version.js')]);

const modelDir = path.join(capsuleDir, 'artifacts', 'model');
const manifest = JSON.parse(await fs.readFile(path.join(modelDir, 'manifest.json'), 'utf8'));
const template = manifest.inference?.chatTemplate;
if (template?.type !== 'qwen' || template.enabled !== true || template.thinking !== false) {
  throw new Error(`Unexpected chatTemplate ${JSON.stringify(template)}`);
}
if (manifest.inference?.output?.reasoningOutput != null) throw new Error('Manifest declares reasoningOutput.');
const templateOptions = template.thinking === true ? { thinking: true } : undefined;
const tokenizer = new Tokenizer();
await tokenizer.initialize(manifest, {
  loadTokenizerJson: async () => JSON.parse(await fs.readFile(path.join(modelDir, 'tokenizer.json'), 'utf8')) });

const write = value => process.stdout.write(JSON.stringify(value) + '\n');
write({ ok: true, ready: true, dopplerVersion: DOPPLER_VERSION, chatTemplate: template, modelId: manifest.modelId });

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  try {
    const request = JSON.parse(line);
    if (request.op === 'render') {
      const text = formatChatMessages(request.messages, template.type, templateOptions);
      write({ ok: true, text, ids: Array.from(tokenizer.encode(text)) });
    } else if (request.op === 'decode') {
      const decoder = tokenizer.createIncrementalDecoder();
      let text = '';
      for (const id of request.ids) text += decoder.push(id);
      text += decoder.finish({ stopReason: request.stopReason });
      write({ ok: true, text });
    } else {
      throw new Error(`Unknown op ${request.op}`);
    }
  } catch (error) {
    write({ ok: false, error: String(error?.stack ?? error) });
  }
}
