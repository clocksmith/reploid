// Prompt-design screening only (not a measurement): runs candidate matrix prompts through Doppler's ordinary
// (unpaired) whole-model pipeline on amd-host, greedy, with the product's repetition penalty, to check that the
// model answers the counting instruction instead of the padding text before a prompt design is used on the
// route. Ordinary arithmetic can differ from the paired profile at near ties, so the route run still measures
// the actual answer length. Same weight shards; the ordinary manifest from the speed-isolation run.
// Usage: node screen-prompts.mjs <doppler package root> <ordinary model dir> <max tokens> <prompt file>...
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [pkg, modelDir, maxArg, ...files] = process.argv.slice(2);
const mod = relative => import(pathToFileURL(path.join(pkg, 'src', relative)).href);
const [{ bootstrapNodeWebGPU }, { installNodeFileFetchShim }, { initDevice }, { createPipeline }, { createNodeFileArtifactStorageContext },
  { formatChatMessages }] = await Promise.all([mod('tooling/node-webgpu.js'), mod('tooling/node-file-fetch.js'), mod('gpu/device.js'),
  mod('inference/pipelines/text.js'), mod('storage/artifact-storage-context.js'), mod('inference/pipelines/text/chat-format.js')]);
const boot = await bootstrapNodeWebGPU(); if (!boot?.ok) throw Error('webgpu ' + boot?.detail);
installNodeFileFetchShim(); await initDevice();
const manifest = JSON.parse(await fs.readFile(path.join(modelDir, 'manifest.json'), 'utf8'));
const pipeline = await createPipeline(manifest, { storage: createNodeFileArtifactStorageContext(pathToFileURL(modelDir + path.sep).href, manifest), ownsLoader: true });
for (const file of files) {
  const text = await fs.readFile(file, 'utf8');
  const messages = [{ role: 'user', content: text }];
  const ids = pipeline.tokenizer.encode(formatChatMessages(messages, manifest.inference.chatTemplate.type));
  pipeline.reset();
  const out = [];
  for await (const token of pipeline.generateTokens(messages, { inputIds: ids, maxTokens: Number(maxArg), useChatTemplate: false,
    temperature: 0, topK: 1, topP: 1, repetitionPenalty: 1.1, repetitionPenaltyWindow: 0 })) out.push(token);
  const answer = out.map(t => typeof t === 'string' ? t : (t?.text ?? '')).join('');
  console.log(JSON.stringify({ file: path.basename(file), promptTokens: ids.length, tokens: out.length, head: answer.slice(0, 160), tail: answer.slice(-60), sample: typeof out[0] }));
}
process.exit(0);
