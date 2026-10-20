/** Replay retained requests through an identified application snapshot; no public peers. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as webgpu from 'webgpu';

const [contractPath, outputPath] = process.argv.slice(2);
assert(contractPath && outputPath, 'Supply frozen contract and new receipt path');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile(contractPath), contract = JSON.parse(bytes);
const load = async path => JSON.parse(await readFile(path));
const fromSnapshot = path => import(pathToFileURL(resolve(contract.snapshot, path)).href);
const retainedBytes = await readFile(contract.receipt);
assert.equal(hash(retainedBytes), contract.receiptSha256);
const retained = JSON.parse(retainedBytes);
const model = (await load(resolve(contract.snapshot, 'self/config/chat-models.json')))
  .find(row => row.id === retained.modelId);
assert.equal(model.identity, contract.modelIdentity);
const manifestText = await readFile(resolve(contract.modelDirectory, 'manifest.json'), 'utf8');
assert.equal('sha256:' + hash(manifestText), contract.modelIdentity);
const manifest = JSON.parse(manifestText);
const { createNativeGpuHost } = await fromSnapshot('server/native-participant.js');
const { createReploidDopplerRuntimeService } = await fromSnapshot('self/infrastructure/doppler-runtime-service.js');
const { openWorkProvider } = await fromSnapshot('self/providers/work-provider.js');
const runtime = await fromSnapshot('node_modules/doppler-gpu/src/index.js');
const profile = await load(resolve(contract.snapshot, 'self/config/work-profile.json'));
const generation = runtime.resolveGenerationOptions({ ...profile.generation, ...model.generation,
  maxTokens: contract.maxTokens, maxSeqLen: contract.maxSeqLen });
// Both APIs use the same bounded settings; preserve the original policy in the contract.
model.generation = generation;
const host = createNativeGpuHost(async () => webgpu);
const service = createReploidDopplerRuntimeService({ loadModule: async () => runtime });
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(new Error('Frozen control deadline reached')), contract.timeoutMs);
const report = { schema: 'reploid.movie-request-control/v1', contractSha256: hash(bytes),
  producerSha256: hash(await readFile(new URL(import.meta.url))), modelIdentity: contract.modelIdentity,
  node: process.version, platform: process.platform, results: [], qualified: false };
// Reserve the destination before acquiring any device; never replace a retained result.
await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const save = () => writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
try {
  await host.open();
  const provider = await openWorkProvider({ model, service, scope: 'movie-control',
    signal: controller.signal, generation, maxOutcomeCharacters: profile.maxOutcomeCharacters,
    source: { manifest, manifestText, manifestHash: contract.modelIdentity.slice(7),
      baseUrl: pathToFileURL(resolve(contract.modelDirectory) + '/').href } });
  const session = service.get('movie-control');
  for (const id of contract.caseIds) {
    const original = retained.results.find(row => row.id === id);
    assert(original, id);
    const messages = structuredClone(original.attempt.request.messages);
    const tokenIds = session.advanced.tokenizePrompt(messages, generation);
    assert.equal(tokenIds.length, original.attempt.execution.completion.promptTokenCount);
    let text = '';
    const streamed = await provider.generate(messages, delta => { text += delta; },
      { signal: controller.signal, maxOutputTokens: contract.maxTokens });
    await session.resetGenerationState();
    const generated = await session.generate(messages, { ...generation, signal: controller.signal });
    await session.resetGenerationState();
    const row = { id, modelIdentity: contract.modelIdentity, originalAnswer: original.answer,
      expected: original.expected, input: { messages, generation },
      result: { tokenIds, evidence: generated }, streamedText: text, streamed,
      originalReproduced: text.trim() === original.answer,
      tokenCaptureMatchesStream: generated.outputText === text };
    report.results.push(row); await save();
    assert(row.tokenCaptureMatchesStream, 'Captured-token generation differs from provider streaming');
    assert.equal(generated.completion.stopReason, 'stop-token');
    console.log(JSON.stringify({ id, text, originalReproduced: row.originalReproduced,
      inputTokens: tokenIds.length, outputTokens: generated.tokenIds }));
  }
} catch (error) {
  report.failure = { name: error.name, message: error.message }; process.exitCode = 1;
} finally {
  clearTimeout(timer);
  try { await service.closeAll(); await host.close(); }
  catch (error) { report.cleanupFailure = error.message; process.exitCode = 1; }
  await save();
}
