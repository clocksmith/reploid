#!/usr/bin/env node
/**
 * Local UI preview server for Poolday with simulated network and GPU timeouts.
 * Serves the real built React app and design system on localhost without needing WebGPU
 * or live peers so screens, drawers, sheets, streaming, progress bars, and error states
 * can be exercised directly in a browser.
 *
 * Usage:
 *   npm run preview:ui:mock
 *   PORT=8045 npm run preview:ui:mock
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveBrowserTree } from '../server/browser-tree.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POOLDAY_DIR = path.join(ROOT, 'apps/poolday');
const LAYERS = JSON.parse(fs.readFileSync(path.join(POOLDAY_DIR, 'styles/poolday/layers.json'), 'utf8'));
const PORT = Number(process.env.PORT || 8040);

const STYLESHEETS = [LAYERS.tokens, ...LAYERS.primitives]
  .map((file) => `    <link rel="stylesheet" href="/styles/poolday/${file}" />`)
  .join('\n');

const MOCK_BOOT_SCRIPT = `
import { createChatSession, CANONICAL_CHAT_MODELS } from '/host/chat-session.js';
import { mountPoolday } from '/ui/react/app.js';
import { createExecutionPolicy } from '/vendor/reploid/chat/execution-policy.js';

const delay = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal.reason || new DOMException('Aborted', 'AbortError'));
    return;
  }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  const onAbort = () => {
    clearTimeout(timer);
    reject(signal?.reason || new DOMException('Aborted', 'AbortError'));
  };
  signal?.addEventListener('abort', onAbort, { once: true });
});

const baseModels = CANONICAL_CHAT_MODELS.slice(0, 3).map((model, index) => ({
  ...model,
  localCached: index === 0,
  networkAvailability: index < 2 ? 'ready' : 'busy',
}));

const modelListeners = new Set();
const notifyModels = () => {
  for (const listener of modelListeners) listener();
};

const peers = [
  { peerId: 'peer:studio-m4-ultra-0001', label: 'Studio M4 Ultra', models: [baseModels[0]?.id].filter(Boolean), busy: false, rttMs: 18 },
  { peerId: 'peer:workstation-rx7900-0002', label: 'Workstation RX 7900', models: [baseModels[0]?.id, baseModels[1]?.id].filter(Boolean), busy: false, rttMs: 42 },
  { peerId: 'peer:laptop-node-0003', label: 'Laptop Node', models: [baseModels[2]?.id].filter(Boolean), busy: true, rttMs: 85 },
];

const mockState = {
  sharing: false,
  computeEnabled: false,
  filesEnabled: false,
  introductions: true,
  preparing: false,
  progress: 0,
  completed: 3,
  tokens: 482,
  pairedHost: null,
  invites: [
    {
      id: 'inv-demo-1',
      state: 'active',
      active: true,
      summary: 'Guest link · expires in 18h',
      usage: '2 / 10 requests · 340 / 2560 tokens',
      queued: '',
    },
  ],
};

let prepAbort = null;
const streamReply = async (promptText, request, controls) => {
  const ids = { threadId: request.threadId, attemptId: request.attemptId };
  const lower = String(promptText || '').toLowerCase();
  controls.onState({
    ...ids,
    status: 'executing',
    execution: { provider: 'local', placement: 'local-browser', label: 'Mock GPU (simulated)' },
  });
  await delay(500, controls.signal);
  if (lower.includes('timeout')) {
    await delay(1400, controls.signal);
    throw new Error('Simulated peer timeout after 1.9 s. Try again or switch computer.');
  }
  if (lower.includes('error')) {
    throw new Error('Simulated GPU runner error: out of mock VRAM.');
  }
  const chunks = [
    'Simulated local response (no GPU required). ',
    'Latency and token streaming are mocked with timers so you can inspect layout, drawers, sheets, and focus transitions. ',
    'Include the word "error" or "timeout" in a prompt to test inline alerts and recovery states. ',
    'Open the Computers drawer to test the migrated ThisComputer and YourComputers screens.',
  ];
  let content = '';
  let sequence = 0;
  for (const chunk of chunks) {
    for (const word of chunk.split(' ')) {
      await delay(45, controls.signal);
      const token = (sequence === 0 ? '' : ' ') + word;
      content += token;
      controls.onDelta({ ...ids, sequence, text: token });
      sequence += 1;
    }
  }
  mockState.completed += 1;
  mockState.tokens += sequence;
  return {
    ...ids,
    modelId: baseModels[0]?.id || 'mock-model',
    modelIdentity: baseModels[0]?.identity || 'mock:model',
    adapterIdentities: [],
    content,
  };
};

const partitions = {
  getModels: () => baseModels.map((model, index) => ({
    ...model,
    selectionId: 'mock-' + index,
    availability: index < 2 ? 'ready' : 'busy',
  })),
  subscribe(listener) {
    modelListeners.add(listener);
    return () => modelListeners.delete(listener);
  },
  async generate(request, controls) {
    const lastMessage = request.messages?.[request.messages.length - 1]?.content || '';
    return streamReply(lastMessage, request, controls);
  },
};

const swarm = {
  getState: () => ({
    sharing: mockState.sharing,
    computeEnabled: mockState.computeEnabled,
    introductions: mockState.introductions,
    consumer: { peers },
    contribution: {
      modelId: baseModels[0]?.id || 'mock-model',
      ready: mockState.computeEnabled && !mockState.preparing,
      phase: mockState.preparing ? 'loading' : (mockState.computeEnabled ? 'ready' : 'idle'),
      progress: mockState.preparing ? { kind: 'downloading', receivedBytes: mockState.progress, totalBytes: 100 } : null,
      completed: mockState.completed,
      production: { outputTokens: mockState.tokens, missingTokenCounts: 0 },
    },
    files: {
      enabled: mockState.filesEnabled,
      sharing: mockState.filesEnabled,
      suppliedBytes: mockState.filesEnabled ? 428000 : 0,
    },
  }),
  async connect() {
    await delay(650);
    notifyModels();
  },
  async setSharing(enabled) {
    if (enabled) {
      mockState.preparing = true;
      mockState.progress = 0;
      prepAbort = new AbortController();
      notifyModels();
      try {
        for (const step of [20, 45, 70, 90, 100]) {
          await delay(320, prepAbort.signal);
          mockState.progress = step;
          notifyModels();
        }
        mockState.preparing = false;
        mockState.sharing = true;
        mockState.computeEnabled = true;
      } catch {
        mockState.preparing = false;
        mockState.sharing = false;
        mockState.computeEnabled = false;
      } finally {
        prepAbort = null;
        notifyModels();
      }
      return;
    }
    prepAbort?.abort();
    mockState.sharing = false;
    mockState.computeEnabled = false;
    mockState.preparing = false;
    notifyModels();
  },
  async setFileSharing(enabled) {
    await delay(250);
    mockState.filesEnabled = Boolean(enabled);
    notifyModels();
  },
  async setIntroductions(enabled) {
    await delay(150);
    mockState.introductions = Boolean(enabled);
    notifyModels();
  },
};

const session = createChatSession({
  partitions,
  swarm,
  storage: localStorage,
  localRunner: {
    isAvailable: () => true,
    async generate(request, controls) {
      const lastMessage = request.messages?.[request.messages.length - 1]?.content || '';
      return streamReply(lastMessage, request, controls);
    },
  },
});

const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
const root = document.getElementById('app');
mountPoolday(root, {
  host: {
    chat: session,
    close: async () => {},
  },
  viewState: {
    privacy,
    chosenModel: partitions.getModels()[0],
    executionLocation: 'local',
  },
});
`;

const MOCK_PAGE_HTML = `<!DOCTYPE html>
<html lang="en" class="pool-page">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>Reploid UI Mock Preview</title>
${STYLESHEETS}
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/__mock__/boot.js"></script>
  </body>
</html>
`;

const app = express();

app.get('/__mock__/boot.js', (_req, res) => {
  res.type('application/javascript; charset=utf-8').send(MOCK_BOOT_SCRIPT);
});

app.get(['/', '/work', '/network', '/ask', '/compute', '/records', '/history'], (_req, res) => {
  res.type('html').send(MOCK_PAGE_HTML);
});

app.get('/design', (_req, res) => {
  res.sendFile(path.join(POOLDAY_DIR, 'design.html'));
});

app.use(serveBrowserTree());

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[preview-ui-mock] Poolday UI mock server running at:`);
  console.log(`  App:        http://127.0.0.1:${PORT}/`);
  console.log(`  Computers:  http://127.0.0.1:${PORT}/?view=computers`);
  console.log(`  Design:     http://127.0.0.1:${PORT}/design`);
});
