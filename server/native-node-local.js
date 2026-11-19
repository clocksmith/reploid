import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import { createChatCompletions } from './chat-completions.js';
import { sha256Digest } from './hashing.js';
import { createNativeGpuHost } from './native-gpu-host.js';
import { readPinnedOrigin, resolvePinnedOrigin } from './native-model-origin.js';
import { readBundledModelMetadata, readOriginModelMetadata } from './native-model-metadata.js';
import { createNativeWholeModel, nativeWholeModelSettings } from './native-whole-model.js';
import { fillWholeModelDirectory, wholeModelDirectoryComplete } from './native-whole-model-fill.js';

async function fillLocalWeights(model, root, signal, log) {
  if (await wholeModelDirectoryComplete(root, model)) return;
  const origin = resolvePinnedOrigin(model);
  if (!origin) throw new Error(`No pinned download for ${model.id}. Supply its complete RDRR directory with --weights.`);
  const manifestFile = model.source.files.find(file => file.path === 'manifest.json');
  const indexFile = model.source.files.find(file => file.role === 'model-piece-index');
  const readMetadata = async file => (await readBundledModelMetadata(file)) ?? readOriginModelMetadata(origin, file, signal);
  const [manifestBytes, indexBytes] = await Promise.all([readMetadata(manifestFile), readMetadata(indexFile)]);
  if (sha256Digest(manifestBytes) !== model.identity) throw new Error('Bundled manifest differs from the model identity');
  const decoder = new TextDecoder();
  const index = JSON.parse(decoder.decode(indexBytes));
  if (index.manifestIdentity !== model.identity) throw new Error('Bundled piece index names a different model');
  await fs.mkdir(root, { recursive: true });
  log(`Downloading verified pieces for ${model.id} into ${root}`);
  await fillWholeModelDirectory({ root, model, manifest: JSON.parse(decoder.decode(manifestBytes)), index, signal,
    concurrency: 4,
    acquire: async piece => ({ bytes: await readPinnedOrigin(origin, piece.path, { offset: piece.offset, size: piece.size, signal }),
      source: origin.id, supplier: origin.supplier }),
    readMetadata,
    freeBytes: async directory => { const stat = await fs.statfs(directory); return stat.bavail * stat.bsize; },
  });
}

export function createLocalTextHandler({ model, alias, resident }) {
  const listing = { id: model.id, object: 'model', owned_by: 'reploid' };
  const localModel = { id: model.id, identity: model.identity, selectionId: alias, availability: 'ready',
    providerIds: ['local'], generationSettings: nativeWholeModelSettings(model) };
  const participant = {
    roomId: 'localhost', executionClass: 'local-only',
    getState: () => ({ models: resident.getState().ready ? [localModel] : [] }),
    async generate(request, controls) {
      const { threadId, attemptId, messages, settings } = request;
      const { signal, requestApproval, onDelta } = controls;
      const binding = { threadId, attemptId, modelId: model.id, modelIdentity: model.identity };
      const approved = await requestApproval({ ...binding, recipients: ['local'], input: { messages, settings } });
      signal.throwIfAborted();
      if (!approved) throw new Error('Local request refused');
      let sequence = 0;
      // The runtime checks the exact token prefix before it reuses cached state. The first message
      // also groups related requests into a bounded local cache instead of evicting on unrelated prompts.
      const contextId = createHash('sha256').update(JSON.stringify(messages[0])).digest('hex');
      const result = await resident.generate(messages, text => onDelta({ threadId, attemptId, sequence: sequence++, text }),
        { signal, settings, contextOwner: 'localhost', contextId });
      const { completion } = result;
      const usage = Number.isSafeInteger(completion?.promptTokenCount) && Number.isSafeInteger(completion?.generatedTokenCount)
        ? { schema: 'raw-model-tokens/v1', inputTokens: completion.promptTokenCount, outputTokens: completion.generatedTokenCount } : undefined;
      return { ...binding, content: result.content, adapterIdentities: result.adapterIdentities,
        execution: { stopReason: completion?.stopReason, completion }, ...(usage ? { usage } : {}) };
    },
  };
  const api = createChatCompletions({ participant, authenticate: async () => ({ subject: 'localhost' }), authorize: async () => true });
  return {
    handle(req, res) {
      const host = req.headers.host;
      const port = req.socket.localPort;
      const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!allowedHosts.includes(host) || req.headers.origin && req.headers.origin !== `http://${host}`) {
        res.writeHead(403).end();
        return;
      }
      if (req.url === '/v1/models' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: resident.getState().ready ? [listing] : [] }));
        return;
      }
      return api.handle(req, res);
    },
    close: () => api.close(),
  };
}

export async function serveLocalModel({ model, alias, modelDirectory, port }) {
  const gpu = createNativeGpuHost(() => import('webgpu'));
  const resident = createNativeWholeModel({ model, modelDirectory, nativeGpu: () => gpu.open(),
    fill: ({ signal }) => fillLocalWeights(model, modelDirectory, signal, console.error) });
  const api = createLocalTextHandler({ model, alias, resident });
  const server = http.createServer((req, res) => api.handle(req, res));
  let closing;
  const close = () => closing ??= (async () => {
    try {
      await Promise.all([api.close(), new Promise((resolve, reject) => server.close(error => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
        else resolve();
      }))]);
    } finally {
      try { await resident.close(); }
      finally { await gpu.close(); }
    }
  })();
  const interrupt = () => close().catch(error => { console.error(error.message); process.exitCode = 1; });
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    const stopped = once(server, 'close');
    await resident.contribute(true);
    console.error(`${model.id} ready at http://127.0.0.1:${port}/v1`);
    await stopped;
  } finally {
    try { await close(); }
    finally {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
  }
}
