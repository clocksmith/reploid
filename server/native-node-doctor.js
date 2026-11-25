import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import bootstrap from '../shared/config/swarm-bootstrap.json' with { type: 'json' };
import dopplerPin from '../shared/config/doppler-package.json' with { type: 'json' };
import { installedPackageDirectory } from './native-shader-cache.js';
import { existsSync } from 'node:fs';
import { describeNativeGpuTries, nativeGpuBackends, requestNativeAdapter, selectNativeGpuBackend, windowsVulkanLoader } from './native-gpu-host.js';
import { modelGpuNeeds } from './native-gpu-features.js';
import catalog from '../shared/config/chat-models.json' with { type: 'json' };

export function readHostMemory() {
  const totalBytes = os.totalmem();
  const availableBytes = process.availableMemory?.() ?? os.freemem();
  return { totalBytes, availableBytes: Math.min(availableBytes, totalBytes) };
}

async function checkRuntime() {
  const entry = createRequire(import.meta.url).resolve('dopplerx/partitions');
  const directory = await installedPackageDirectory(entry, dopplerPin.name);
  const { version } = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  if (version !== dopplerPin.version) throw Error(`found ${version}; this package requires ${dopplerPin.version}`);
  return `${version} matches the pinned version`;
}

/** Probes the backends the host would try, in its order, against the features `model`'s manifest requires, and
 * reports each one tried and the one the host would choose. Doctor never copies files: on Windows it says whether
 * Dawn can open Vulkan and prints the one-line fix the host otherwise applies itself at startup. */
export async function inspectNativeAdapter({ model = null, platform = process.platform, resolveNeeds = modelGpuNeeds } = {}) {
  const { create } = await import('webgpu');
  const needs = model ? await resolveNeeds({ model, mode: 'whole-model' }).catch(() => null) : null;
  const loader = platform === 'win32' ? windowsVulkanLoader() : null;
  const selection = await selectNativeGpuBackend({ backends: nativeGpuBackends(platform), needs,
    probe: async backend => ({ adapter: await requestNativeAdapter(create(['backend=' + backend])) }) }).catch(error => {
    const tried = describeNativeGpuTries(error.tried ?? []);
    throw Error(`no adapter found (${tried}); check the GPU driver and the optional webgpu package${vulkanHint(error.tried, loader)}`);
  });
  const adapter = selection.probed.adapter, limits = adapter.limits;
  return { backend: selection.chosen, name: selection.tried.find(row => row.backend === selection.chosen).adapter,
    shaderF16: adapter.features?.has('shader-f16') ?? null, tried: selection.tried, remap: selection.remap, unmet: selection.unmet,
    modelId: needs?.modelId ?? null, required: needs?.required ?? null, vulkanLoader: loader && vulkanHint(selection.tried, loader),
    maxBufferSize: limits?.maxBufferSize ?? null, maxStorageBufferBindingSize: limits?.maxStorageBufferBindingSize ?? null,
    maxStorageBuffersPerShaderStage: limits?.maxStorageBuffersPerShaderStage ?? null };
}

// Dawn on Windows opens Vulkan only with vulkan-1.dll beside its binary (native-gpu-host.js windowsVulkanLoader).
function vulkanHint(tried, loader) {
  if (!loader?.fix || !existsSync(loader.from) || existsSync(loader.to)) return '';
  if (!tried?.some(row => row.backend === 'vulkan' && !row.adapter)) return '';
  return `; vulkan-1.dll is not beside Dawn (the host copies it at startup), or run: ${loader.fix}`;
}

async function checkAdapter(model) {
  const adapter = await inspectNativeAdapter({ model });
  const binding = adapter.maxStorageBufferBindingSize == null ? '' : `, max storage binding ${adapter.maxStorageBufferBindingSize} B`;
  const f16 = adapter.shaderF16 == null ? '' : adapter.shaderF16 ? ', shader-f16' : ', no shader-f16 (f16-kernel models will not load)';
  const lines = [`${adapter.backend}, ${adapter.name}${binding}${f16}`];
  if (adapter.modelId) {
    lines.push(`      ${adapter.modelId} requires ${adapter.required.length ? adapter.required.join(', ') : 'no optional features'}`);
  }
  for (const row of adapter.tried) {
    lines.push(`      tried ${row.backend}: ${row.adapter ? `${row.adapter}, ${row.missing.length ? 'lacks ' + row.missing.join(', ') : 'has every required feature'}`
      : `no adapter (${row.error})`}`);
  }
  const how = adapter.unmet.length ? `; lacks ${adapter.unmet.join(', ')}, which Doppler cannot remap, so the model may not load`
    : adapter.remap.length ? `; Doppler's capability remap stands in for ${adapter.remap.join(', ')}` : '';
  lines.push(`      chosen ${adapter.backend}${how}${adapter.vulkanLoader || ''}`);
  return lines.join('\n');
}

async function checkSignaling(signalingUrl, origin) {
  const url = new URL(signalingUrl);
  if (!['ws:', 'wss:'].includes(url.protocol)) throw Error('expected a ws:// or wss:// signaling URL');
  // The rendezvous endpoint validates discovery scope during its HTTP upgrade.
  url.searchParams.set('scope', 'public');
  url.searchParams.set('roomId', bootstrap.publicRoomId);
  const { default: WebSocket } = await import('ws');
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin, handshakeTimeout: 5000, followRedirects: false });
    socket.once('error', reject);
    socket.once('open', () => {
      socket.terminate();
      resolve();
    });
  });
  return `WebSocket handshake succeeded at ${url.host}`;
}

/** No request, identity, weight download, model load, or GPU device is needed for these checks. */
/** `model` (a catalog id) is the model whose required GPU features the adapter check compares; null checks none. */
export async function runDoctor({ signalingUrl = bootstrap.signalingUrl, origin = 'http://localhost:8000', model = null } = {}) {
  const selected = model ? catalog.find(row => row.id === model) ?? null : null;
  const checks = [
    ['Node', () => {
      const [major, minor] = process.versions.node.split('.').map(Number);
      if (major < 22 || major === 22 && minor < 13) throw Error(`${process.versions.node}; install Node 22.13 or newer`);
      return process.versions.node;
    }],
    ['Host RAM', () => {
      const { availableBytes, totalBytes } = readHostMemory();
      const gib = bytes => (bytes / 2 ** 30).toFixed(1);
      return `${gib(availableBytes)} GiB currently available to Node, ${gib(totalBytes)} GiB physical`;
    }],
    ['Doppler version', checkRuntime],
    ['WebGPU adapter', () => checkAdapter(selected)],
    ['Signaling', () => checkSignaling(signalingUrl, origin)],
  ];
  const results = await Promise.allSettled(checks.map(([, check]) => Promise.resolve().then(check)));
  return {
    ok: results.every(result => result.status === 'fulfilled'),
    text: results.map((result, i) => result.status === 'fulfilled'
      ? `OK    ${checks[i][0]}  ${result.value}`
      : `FAIL  ${checks[i][0]}  ${result.reason?.message || result.reason}`).join('\n'),
  };
}
