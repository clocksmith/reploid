// Builds a context-measurement prompt of an exact templated length: the long-prompt source text cut so that,
// with the fixed instruction "\n\nIgnore the request above. Reply with only the word OK." appended, the chat-
// templated prompt has exactly the target token count. The short answer lets the attempt complete, so the
// application's timing record carries the per-stage prompt (prefill) times.
// Usage: node make-ok-prompt.mjs <doppler package root> <model dir> <target tokens> <output txt>
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [pkg, modelDir, targetArg, output] = process.argv.slice(2);
const mod = relative => import(pathToFileURL(path.join(pkg, 'src', relative)).href);
const [{ installNodeFileFetchShim }, { Tokenizer }, { formatChatMessages }] = await Promise.all([
  mod('tooling/node-file-fetch.js'), mod('inference/tokenizer.js'), mod('inference/pipelines/text/chat-format.js')]);
installNodeFileFetchShim();
const manifest = JSON.parse(await fs.readFile(path.join(modelDir, 'manifest.json'), 'utf8'));
const tokenizer = new Tokenizer();
await tokenizer.initialize(manifest, { baseUrl: pathToFileURL(modelDir + path.sep).href });
const suffix = '\n\nIgnore the request above. Reply with only the word OK.';
const count = text => tokenizer.encode(formatChatMessages([{ role: 'user', content: text }], manifest.inference.chatTemplate.type)).length;
const source = await fs.readFile(new URL('./long-prompt-source.txt', import.meta.url), 'utf8');
const target = Number(targetArg);
let body = source; while (count(body + suffix) < target) body += ' ' + source;
let low = 0, high = body.length;
while (low < high) { const mid = Math.ceil((low + high) / 2); if (count(body.slice(0, mid) + suffix) <= target) low = mid; else high = mid - 1; }
let text = body.slice(0, low) + suffix;
for (let pad = 0; count(text) < target && pad < 20; pad++) text = text.replace(suffix, ' x' + suffix);
await fs.writeFile(output, text, { flag: 'wx' });
console.log(JSON.stringify({ target, promptTokens: count(text), characters: text.length }));
