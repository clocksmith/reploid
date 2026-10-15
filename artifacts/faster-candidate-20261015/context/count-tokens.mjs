// Counts the chat-templated prompt tokens of one user message with the candidate runtime's own tokenizer and
// chat formatter (no GPU), so long-prompt texts can be cut to an exact prompt length. Prints JSON.
// Usage: node count-tokens.mjs <doppler package root> <model dir> <text file> [target tokens]
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [pkg, modelDir, textFile, targetArg] = process.argv.slice(2);
const mod = relative => import(pathToFileURL(path.join(pkg, 'src', relative)).href);
const [{ installNodeFileFetchShim }, { Tokenizer }, { formatChatMessages }] = await Promise.all([
  mod('tooling/node-file-fetch.js'), mod('inference/tokenizer.js'), mod('inference/pipelines/text/chat-format.js')]);
installNodeFileFetchShim();
const manifest = JSON.parse(await fs.readFile(path.join(modelDir, 'manifest.json'), 'utf8'));
const tokenizer = new Tokenizer();
await tokenizer.initialize(manifest, { baseUrl: pathToFileURL(modelDir + path.sep).href });
const count = text => tokenizer.encode(formatChatMessages([{ role: 'user', content: text }], manifest.inference.chatTemplate.type)).length;
const text = await fs.readFile(textFile, 'utf8');
const out = { characters: text.length, promptTokens: count(text) };
if (targetArg) {
  const target = Number(targetArg);
  // Longest prefix (cut at a whitespace boundary) whose templated prompt has at most the target tokens.
  let low = 0, high = text.length;
  while (low < high) { const mid = Math.ceil((low + high) / 2); if (count(text.slice(0, mid)) <= target) low = mid; else high = mid - 1; }
  let cut = text.slice(0, low); const space = cut.lastIndexOf(' '); if (space > 0 && count(cut) !== target) cut = cut.slice(0, space);
  Object.assign(out, { target, cutCharacters: cut.length, cutPromptTokens: count(cut) });
  await fs.writeFile(textFile.replace(/\.txt$/, `-${target}.txt`), cut, { flag: 'wx' });
}
console.log(JSON.stringify(out));
