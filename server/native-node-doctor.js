import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import bootstrap from '../shared/config/swarm-bootstrap.json' with { type: 'json' };
import dopplerPin from '../shared/config/doppler-package.json' with { type: 'json' };
import { installedPackageDirectory } from './native-shader-cache.js';

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

async function checkAdapter() {
  const { create } = await import('webgpu');
  const backend = process.platform === 'darwin' ? 'metal' : 'vulkan';
  const gpu = create(['backend=' + backend]);
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw Error(`no ${backend} adapter found; check the GPU driver and the optional webgpu package`);
  const name = adapter.info?.description || adapter.info?.device || adapter.info?.vendor || 'adapter available';
  return `${backend}, ${name}`;
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
export async function runDoctor({ signalingUrl = bootstrap.signalingUrl, origin = 'http://localhost:8000' } = {}) {
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
    ['WebGPU adapter', checkAdapter],
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
