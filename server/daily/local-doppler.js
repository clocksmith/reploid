import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativeWholeModel } from '../native-whole-model.js';
import { createNativeGpuHost } from '../native-gpu-host.js';
import { createReploidDopplerRuntimeService } from '../../shared/infrastructure/doppler-runtime-service.js';
import { REVERSE_PROMPT_GENERATION, hasReversePromptTemplate } from '../../shared/infrastructure/reverse-prompt-profile.js';
import { readWorkGenerationCompletion } from '../../shared/infrastructure/generation-completion.js';
import { verifyInstalledPackage } from '../../tests/fixtures/installed-package-identity.js';
import { measuredOutput } from './challenges.js';
import { PROFILE } from './rules.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// Both the private physical collector and the direct playtest open these exact
// bytes. Nothing is downloaded, enrolled, or advertised as a network provider.
export async function openDailyPhysical(directory) {
  const archive = path.join(root,'deploy/artifacts/dopplerx-0.1.5.tgz');
  await verifyInstalledPackage({packageArchive:{path:archive, sha256:PROFILE.runtimeArchive},
    installedPackage:path.join(root,'node_modules','dopplerx')});
  const model = (await readJson(path.join(root,'shared/config/chat-models.json'))).find(item => item.id === PROFILE.modelId);
  const modelDirectory = await realpath(directory);
  const manifestFile = path.join(modelDirectory,'manifest.json');
  const manifest = await readJson(manifestFile);
  if ('sha256:' + await fileHash(manifestFile) !== PROFILE.modelIdentity || !hasReversePromptTemplate(manifest)) throw Error('Pinned manifest or non-thinking chat template missing');
  const tokenizer = model.source.files.find(entry => entry.role === 'tokenizer');
  if (!tokenizer || await fileHash(path.join(modelDirectory,tokenizer.path)) !== tokenizer.hash) throw Error('Pinned tokenizer bytes required');
  for (const shard of manifest.shards) {
    if (await fileHash(path.join(modelDirectory, shard.filename)) !== shard.hash) throw Error('Invalid model shard digest');
  }
  const nativeBackend = process.platform === 'darwin' ? 'metal' : 'vulkan';
  const gpu = createNativeGpuHost(() => import('webgpu'), {backend:nativeBackend});
  const service = createReploidDopplerRuntimeService({loadModule: () => import('dopplerx/compat')});
  let session;
  const measuredService = {...service, async open(options) { session = await service.open(options); return session; }};
  const whole = createNativeWholeModel({model, modelDirectory, service:measuredService, nativeGpu: () => gpu.open()});
  const close = async () => { try { await whole.close(); } finally { await gpu.close(); } };
  try {
    if (!(await whole.contribute(true)).ready) throw Error('Model failed to open');
    return { nativeBackend, close, async measure(prompt, { signal, onDispatch } = {}) {
      signal?.throwIfAborted();
      await session.resetGenerationState();
      signal?.throwIfAborted();
      onDispatch?.();
      const result = await session.generate([{role:'system',content:PROFILE.system},{role:'user',content:prompt}],
        {...REVERSE_PROMPT_GENERATION, ...(signal ? {signal} : {})});
      const evidence = result.evidence;
      if (result.outputText !== evidence?.transcript?.outputText) throw Error('Visible text differs from the generation transcript');
      const {schema,transcript,transcriptHash,runtimeProfile,runtimeProfileHash,generationConfig,generationConfigHash,backendIdentity,backendIdentityHash} = evidence;
      return { completion:readWorkGenerationCompletion(result), reusedPrefixTokens:evidence.stats?.reusedPrefixTokens,
        evidence:{schema,transcript,transcriptHash,runtimeProfile,runtimeProfileHash,generationConfig,generationConfigHash,backendIdentity,backendIdentityHash} };
    } };
  } catch (error) { await close(); throw error; }
}

export async function openLocalPlaytest({directory, backendIdentityHash}) {
  const physical = await openDailyPhysical(directory);
  return { close:physical.close, async run({prompt, signal, onDispatch}) {
    const record = await physical.measure(prompt, {signal, onDispatch});
    const actual = measuredOutput(record, {nativeBackend:physical.nativeBackend});
    if (!actual || actual.backend !== backendIdentityHash) throw Error('Local playtest execution differed from pinned physical evidence.');
    return { output:actual.output, receipt:{schema:'reploid.local-playtest-evidence/v1', nativeBackend:physical.nativeBackend, ...record} };
  } };
}
