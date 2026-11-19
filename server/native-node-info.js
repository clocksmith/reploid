import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import bootstrap from '../shared/config/swarm-bootstrap.json' with { type: 'json' };
import dopplerPin from '../shared/config/doppler-package.json' with { type: 'json' };
import { resolveServedFile } from './browser-roots.js';
import { resolvePinnedOrigin } from './native-model-origin.js';
import { installedPackageDirectory } from './native-shader-cache.js';

const GIB = 2 ** 30;
export const gib = bytes => `${(bytes / GIB).toFixed(1)} GiB`;

export async function modelSizing(model, { totalBytes = os.totalmem() } = {}) {
  const descriptor = model.source?.files?.find(file => file.role === 'model-piece-index');
  const index = descriptor ? JSON.parse(await fs.readFile(resolveServedFile(descriptor.url), 'utf8')) : null;
  const weightBytes = index?.files.reduce((sum, file) => sum + file.size, 0) ?? null;
  // A first-pass RAM estimate. GPU bindings, activation precision and context size can still rule out a model.
  const estimatedRamBytes = weightBytes === null ? null : weightBytes + 4 * GIB;
  return { weightBytes, estimatedRamBytes, estimatedRamFit: estimatedRamBytes === null ? null : estimatedRamBytes <= totalBytes,
    weightSources: resolvePinnedOrigin(model) ? ['pinned-origin', 'authorized-peers', 'local'] : ['authorized-peers', 'local'] };
}

async function checkSignaling(url, room) {
  const { WebSocket } = await import('ws');
  const endpoint = new URL(url);
  endpoint.searchParams.set('scope', room === bootstrap.publicRoomId ? 'public' : 'private');
  endpoint.searchParams.set('roomId', room);
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint, { origin: 'http://localhost:8000', handshakeTimeout: 5_000 });
    socket.once('error', reject);
    socket.once('open', () => { socket.terminate(); resolve(); });
  });
  return `${endpoint.host} accepted the WebSocket handshake`;
}

export async function doctor(argv) {
  const { values } = parseArgs({ args: argv, options: { signaling: { type: 'string' }, room: { type: 'string' }, json: { type: 'boolean' } } });
  const [major, minor] = process.versions.node.split('.').map(Number);
  const items = [{ check: 'Node', ok: major > 22 || major === 22 && minor >= 13, detail: process.version },
    { check: 'RAM', ok: null, detail: `${gib(os.totalmem())} total, ${gib(process.availableMemory())} available to this process` }];
  const probe = async (check, run) => {
    try { return { check, ok: true, detail: await run() }; }
    catch (error) { return { check, ok: false, detail: error.message }; }
  };
  items.push(...await Promise.all([
    probe('Doppler pin', async () => {
      const entry = fileURLToPath(import.meta.resolve('doppler-gpu/compat'));
      const directory = await installedPackageDirectory(path.dirname(entry), 'doppler-gpu');
      const installed = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')).version;
      if (installed !== dopplerPin.version) throw new Error(`Installed ${installed}, expected ${dopplerPin.version}`);
      return installed;
    }),
    probe('WebGPU adapter', async () => {
      const backend = process.platform === 'darwin' ? 'metal' : 'vulkan';
      const { create } = await import('webgpu');
      const gpu = create([`backend=${backend}`]);
      const adapter = await gpu.requestAdapter();
      if (!adapter) throw new Error(`No ${backend} WebGPU adapter`);
      return `${backend} · ${adapter.info?.description || adapter.info?.device || 'adapter available'}`;
    }),
    probe('Signaling', () => checkSignaling(values.signaling ?? bootstrap.signalingUrl, values.room ?? bootstrap.publicRoomId)),
  ]));
  if (values.json) console.log(JSON.stringify(items, null, 2));
  else for (const item of items) console.log(`${item.ok === null ? 'INFO' : item.ok ? 'OK' : 'FAIL'}  ${item.check}  ${item.detail}`);
  return items.every(item => item.ok !== false);
}
