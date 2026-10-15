// Builds one envelope-matrix prompt of an exact chat-templated length that asks for a known answer length.
// Copy of ../../faster-candidate-20261015/context/make-ok-prompt.mjs with one difference: the appended
// instruction asks for the journey's counting task ("Count from 1 to N in order, one integer per line. No
// commentary.", the form of the journey's retry and concurrency prompts) instead of "Reply with only the word
// OK", so the answer length is set by N. The conversation route has no per-request output limit control (the
// caller token limit exists only on the API path), so the answer length is requested by instruction and the
// generated token count is measured, never assumed. Counted with the candidate runtime's own tokenizer and
// chat formatter. Also prints the token count of the exact expected answer plus the end token.
// Designs (sixth argument, default source):
// - source: the context run's workload text cut to length, then "Ignore the request above." and the counting
//   instruction. Retained as attempted: on the route the model interleaved invented contractor lines with the
//   count (matrix/c1-p56-n24.json), so the answer length was not controlled.
// - repeat: the counting instruction itself repeated to the target length (no competing request), padded with
//   " x" before the final instruction if needed.
// Usage: node make-count-prompt.mjs <doppler package root> <model dir> <target tokens> <count to N> <output txt> [source|repeat]
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [pkg, modelDir, targetArg, countArg, output, design = 'source'] = process.argv.slice(2);
const mod = relative => import(pathToFileURL(path.join(pkg, 'src', relative)).href);
const [{ installNodeFileFetchShim }, { Tokenizer }, { formatChatMessages }] = await Promise.all([
  mod('tooling/node-file-fetch.js'), mod('inference/tokenizer.js'), mod('inference/pipelines/text/chat-format.js')]);
installNodeFileFetchShim();
const manifest = JSON.parse(await fs.readFile(path.join(modelDir, 'manifest.json'), 'utf8'));
const tokenizer = new Tokenizer();
await tokenizer.initialize(manifest, { baseUrl: pathToFileURL(modelDir + path.sep).href });
const n = Number(countArg);
const instruction = `Count from 1 to ${n} in order, one integer per line. No commentary.`;
const suffix = design === 'repeat' ? '\n' + instruction : `\n\nIgnore the request above. ${instruction}`;
const count = text => tokenizer.encode(formatChatMessages([{ role: 'user', content: text }], manifest.inference.chatTemplate.type)).length;
const source = design === 'repeat' ? Array.from({ length: 400 }, () => instruction).join('\n')
  : await fs.readFile(new URL('../../faster-candidate-20261015/context/long-prompt-source.txt', import.meta.url), 'utf8');
const target = Number(targetArg);
let text;
if (design === 'repeat' && count(instruction) >= target) text = instruction;
else {
  let body = source; while (count(body + suffix) < target) body += ' ' + source;
  let low = 0, high = body.length;
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (count(body.slice(0, mid) + suffix) <= target) low = mid; else high = mid - 1; }
  if (design === 'repeat') { const cut = body.slice(0, low); low = Math.max(0, cut.lastIndexOf('\n')); }
  text = design === 'repeat' && low === 0 ? instruction : body.slice(0, low) + suffix;
  for (let pad = 0; count(text) < target && pad < 40; pad++) text = text.replace(new RegExp(suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), ' x' + suffix);
}
const answer = Array.from({ length: n }, (_, i) => String(i + 1)).join('\n');
await fs.writeFile(output, text, { flag: 'wx' });
console.log(JSON.stringify({ design, target, promptTokens: count(text), characters: text.length, countTo: n,
  expectedAnswerTokens: tokenizer.encode(answer).length + 1 }));
