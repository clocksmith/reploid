// Private operator tooling. No network service, provider enrollment, or production publication.
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../packages/reploid/src/artifacts/canonical-json.js';
import { createNativeWholeModel } from '../server/native-whole-model.js';
import { createNativeGpuHost } from '../server/native-gpu-host.js';
import { createReploidDopplerRuntimeService } from '../shared/infrastructure/doppler-runtime-service.js';
import { REVERSE_PROMPT_GENERATION, hasReversePromptTemplate } from '../shared/infrastructure/reverse-prompt-profile.js';
import { readWorkGenerationCompletion } from '../shared/infrastructure/generation-completion.js';
import { verifyInstalledPackage } from '../tests/fixtures/installed-package-identity.js';
import { PROFILE, RULE_VERSION, judgePrompt } from '../server/daily/rules.js';
import { CALENDAR_SCHEMA, QUALIFICATION_SCHEMA } from '../server/daily/challenges.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const write = (file, value) => writeFile(file, JSON.stringify(value) + '\n', {flag:'wx', mode:0o600});
async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function measure(directory, bankFile, provider, destination, key) {
  const providerId = provider === '-' ? null : provider;
  if (providerId !== null && !/^peer:[a-f0-9]{24}$/.test(providerId)) throw Error('Expected an enrolled provider identity, or - for reference hardware');
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
  const bank = await readJson(bankFile);
  const nativeBackend = process.platform === 'darwin' ? 'metal' : 'vulkan';
  const gpu = createNativeGpuHost(() => import('webgpu'), {backend:nativeBackend});
  const service = createReploidDopplerRuntimeService({loadModule: () => import('dopplerx/compat')});
  let session;
  const measuredService = {...service, async open(options) { session = await service.open(options); return session; }};
  const whole = createNativeWholeModel({model, modelDirectory, service:measuredService, nativeGpu: () => gpu.open()});
  const attempts = [];
  try {
    if (!(await whole.contribute(true)).ready) throw Error('Model failed to open');
    for (const {target, prompts} of bank) {
      for (const candidate of prompts) {
        let prompt;
        try { prompt = judgePrompt(candidate,target).prompt; } catch { continue; }
        await session.resetGenerationState();
        const result = await session.generate([{role:'system',content:PROFILE.system},{role:'user',content:prompt}], REVERSE_PROMPT_GENERATION);
        const evidence = result.evidence;
        if (result.outputText !== evidence?.transcript?.outputText) throw Error('Visible text differs from the generation transcript');
        const {schema,transcript,transcriptHash,runtimeProfile,runtimeProfileHash,generationConfig,generationConfigHash,backendIdentity,backendIdentityHash} = evidence;
        attempts.push({target, prompt, completion:readWorkGenerationCompletion(result), reusedPrefixTokens:evidence.stats?.reusedPrefixTokens,
          evidence:{schema,transcript,transcriptHash,runtimeProfile,runtimeProfileHash,generationConfig,generationConfigHash,backendIdentity,backendIdentityHash}});
      }
    }
  } finally { try { await whole.close(); } finally { await gpu.close(); } }
  const report = {schema:QUALIFICATION_SCHEMA,profile:PROFILE,ruleVersion:RULE_VERSION,providerId,nativeBackend,attempts};
  await write(destination, key ? await signed(report,key) : report);
}
async function signed(body, keyFile) {
  const key = createPrivateKey(await readFile(keyFile));
  if (key.asymmetricKeyType !== 'ed25519') throw Error('Daily calendar requires an Ed25519 operator key');
  return {...body,signature:sign(null, Buffer.from(canonicalize(body)), key).toString('base64')};
}

const [command,...args] = process.argv.slice(2);
if (command === 'measure' && args.length === 5) {
  await measure(args[0],args[1],args[2],args[4],args[3]);
} else if (command === 'collect' && args.length === 4) {
  await measure(...args);
} else if (command === 'endorse' && args.length === 3) {
  const [reportFile,keyPath,out] = args, body = await readJson(reportFile);
  if (body.schema !== QUALIFICATION_SCHEMA || body.signature || !Array.isArray(body.attempts)) throw Error('Expected an unsigned local qualification report');
  await write(out,await signed(body,keyPath));
} else if (command === 'sign-calendar' && args.length === 3) {
  const [daysFile,keyPath,out] = args;
  await write(out,await signed({schema:CALENDAR_SCHEMA,days:await readJson(daysFile)},keyPath));
} else {
  throw Error('Use collect MODEL_DIR PRIVATE_BANK PROVIDER_OR_DASH PRIVATE_REPORT; endorse REPORT OPERATOR_KEY SIGNED_REPORT; measure MODEL_DIR PRIVATE_BANK PROVIDER_OR_DASH OPERATOR_KEY SIGNED_REPORT; or sign-calendar DAYS_JSON OPERATOR_KEY SIGNED_CALENDAR');
}
