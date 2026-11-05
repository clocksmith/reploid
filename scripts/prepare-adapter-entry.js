/**
 * Prepare a catalog entry for a LoRA adapter trained against one catalog base model.
 * It hashes the PEFT safetensors bytes, computes the Doppler execution identity with the pinned
 * Doppler loader (no GPU), binds the entry to the base model's exact artifact identity and prints
 * the `availableAdapters` entry. It does not train, upload, serve or evaluate; `evaluation` stays
 * null until a verified receipt exists. See docs/adapters.md.
 *
 *   node scripts/prepare-adapter-entry.js --base <catalog model id> --file <adapter_model.safetensors>
 *     --weights-url <immutable https URL of the same bytes> --id <adapter id> --name <display name> --version <x.y.z>
 *     [--config <adapter_config.json>] [--layout peft|native] [--purpose <text> --purpose-source publisher|owner --purpose-url <url>]
 *     [--out <entry.json>]
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveServedFile } from '../server/browser-roots.js';

const root = () => path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const fail = message => { throw new Error(message); };

/** Target modules named by PEFT tensor keys such as `...layers.3.self_attn.q_proj.lora_A.weight`. */
export function safetensorsTargetModules(bytes) {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = Number(view.readBigUInt64LE(0));
  if (!Number.isSafeInteger(size) || size <= 0 || size + 8 > view.length) fail('Not a safetensors file');
  const header = JSON.parse(view.subarray(8, 8 + size).toString('utf8'));
  const modules = new Set();
  for (const name of Object.keys(header)) {
    if (name === '__metadata__') continue;
    const match = name.match(/\.([A-Za-z0-9_]+)\.lora_[AB](?:\.[A-Za-z0-9_]+)?\.weight$/);
    if (!match) fail(`Unrecognized LoRA tensor name: ${name}`);
    modules.add(match[1]);
  }
  return [...modules].sort();
}

export async function prepareAdapterEntry({ models, base, bytes, weightsUrl, id, name, version, layout = 'peft', config = null, purpose = null }) {
  const model = models.find(item => item.id === base);
  if (!model || !/^sha256:[a-f0-9]{64}$/.test(model.identity || '')) fail(`Base model ${base} is not an identified catalog model`);
  if (!/^[a-z0-9][a-z0-9-]{1,95}$/.test(id || '')) fail('--id must be lowercase letters, digits and hyphens');
  if (!name || !/^\d+\.\d+\.\d+$/.test(version || '')) fail('--name and a semantic --version are required');
  if (!['peft', 'native'].includes(layout)) fail('--layout must be peft or native');
  const url = new URL(weightsUrl);
  if (url.protocol !== 'https:' || !/\/[a-f0-9]{40}\//.test(url.pathname)) fail('--weights-url must be https and pinned to a 40-hex revision');
  if ((model.availableAdapters || []).some(entry => entry.id === id)) fail(`Adapter ${id} is already in the catalog`);
  const modules = safetensorsTargetModules(bytes);
  if (config) {
    const declared = [...new Set(config.target_modules || [])].sort();
    if (declared.length && JSON.stringify(declared) !== JSON.stringify(modules)) fail('adapter_config target_modules differ from the tensors');
  }
  const rank = config?.r, alpha = config?.lora_alpha;
  if (!Number.isSafeInteger(rank) || rank <= 0 || !Number.isFinite(alpha) || alpha <= 0) fail('adapter_config.json must declare r and lora_alpha');
  const hex = createHash('sha256').update(bytes).digest('hex');
  const manifest = { id, name, version, baseModel: model.id, rank, alpha, targetModules: modules, weightsFormat: 'safetensors',
    weightsPath: url.href, weightsSize: bytes.byteLength, checksum: hex, checksumAlgorithm: 'sha256' };
  // The same loader the runtime uses computes the identity providers report as executed.
  const { loadLoRAFromManifest } = await import('doppler-gpu/training');
  const loaded = await loadLoRAFromManifest(manifest, { weightsLayout: layout,
    fetchUrl: async requested => { if (requested !== url.href) fail('Doppler requested an undeclared file'); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } });
  return { id, name, identity: loaded.identity.digest, baseModelIdentity: model.identity, weightsLayout: layout,
    purpose: purpose?.statement ? purpose : null, evaluation: null,
    artifact: { artifactId: id, role: 'adapter', path: path.posix.basename(url.pathname), sizeBytes: bytes.byteLength, hash: 'sha256:' + hex, url: url.href },
    manifest };
}

async function main() {
  const { values } = parseArgs({ options: Object.fromEntries(['base', 'file', 'weights-url', 'id', 'name', 'version', 'config', 'layout',
    'purpose', 'purpose-source', 'purpose-url', 'out'].map(key => [key, { type: 'string' }])) });
  const models = JSON.parse(await readFile(resolveServedFile('config/chat-models.json'), 'utf8'));
  const bytes = new Uint8Array(await readFile(values.file ?? fail('--file is required')));
  const config = values.config ? JSON.parse(await readFile(values.config, 'utf8')) : null;
  if (values.purpose && !['publisher', 'owner'].includes(values['purpose-source'])) fail('--purpose-source must be publisher or owner');
  const entry = await prepareAdapterEntry({ models, base: values.base, bytes, weightsUrl: values['weights-url'] ?? fail('--weights-url is required'),
    id: values.id, name: values.name, version: values.version, layout: values.layout ?? 'peft', config,
    purpose: values.purpose ? { statement: values.purpose, source: values['purpose-source'], ...(values['purpose-url'] ? { url: values['purpose-url'] } : {}) } : null });
  const text = JSON.stringify(entry, null, 2) + '\n';
  if (values.out) await writeFile(values.out, text); else process.stdout.write(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`[prepare-adapter-entry] ${error.message}`); process.exitCode = 1; });
}
