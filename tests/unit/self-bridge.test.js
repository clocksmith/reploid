import { beforeEach, describe, expect, it, vi } from 'vitest';

const fileStore = new Map();
const mockChat = vi.fn();
const mockLoadVfsModule = vi.fn();

vi.mock('../../src/core/utils.js', () => ({
  default: {
    factory: () => ({
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      },
      generateId: (prefix = 'id') => `${prefix}_test`,
      createSubscriptionTracker: () => ({
        track: vi.fn(),
        unsubscribeAll: vi.fn()
      })
    })
  }
}));

vi.mock('../../src/core/provider-registry.js', () => ({
  default: {
    factory: () => ({})
  }
}));

vi.mock('../../src/core/llm-client.js', () => ({
  default: {
    factory: () => ({
      chat: mockChat
    })
  }
}));

vi.mock('../../src/infrastructure/stream-parser.js', () => ({
  default: {
    factory: () => ({})
  }
}));

vi.mock('../../src/core/vfs-module-loader.js', () => ({
  loadVfsModule: (...args) => mockLoadVfsModule(...args)
}));

vi.mock('../../src/boot-helpers/vfs-bootstrap.js', () => ({
  readVfsFile: async (path) => fileStore.get(path) ?? null,
  writeVfsFile: async (path, content) => {
    fileStore.set(path, content);
    return true;
  },
  listVfsKeys: async () => Array.from(fileStore.keys())
}));

import { createSelfBridge } from '../../src/self/bridge.js';

describe('Self Bridge', () => {
  beforeEach(() => {
    fileStore.clear();
    mockChat.mockReset();
    mockLoadVfsModule.mockReset();
    fileStore.set('/.memory/leaderboard.json', '[]');
  });

  it('injects callTool so dynamic tools can invoke other loaded tools', async () => {
    mockLoadVfsModule.mockImplementation(async ({ path }) => {
      if (path === '/tools/evaluator.js') {
        return {
          tool: {
            name: 'evaluatePrompt',
            call: async ({ variantId }) => ({
              variantId,
              score: 0.75,
              status: 'completed'
            })
          }
        };
      }

      if (path === '/tools/orchestrator.js') {
        return {
          tool: {
            name: 'orchestrator',
            call: async ({ variantId }, { callTool, readFile, writeFile }) => {
              const file = await readFile({ path: '/.memory/leaderboard.json' });
              const leaderboard = JSON.parse(file.content || '[]');
              const result = await callTool('evaluatePrompt', { variantId });
              leaderboard.push(result);
              await writeFile({
                path: '/.memory/leaderboard.json',
                content: JSON.stringify(leaderboard)
              });
              return leaderboard;
            }
          }
        };
      }

      throw new Error(`Unexpected module path: ${path}`);
    });

    const host = createSelfBridge({
      modelConfig: {
        id: 'test-model',
        provider: 'webllm'
      }
    });

    await host.executeTool('LoadModule', { path: '/tools/evaluator.js' });
    await host.executeTool('LoadModule', { path: '/tools/orchestrator.js' });

    const leaderboard = await host.executeTool('orchestrator', { variantId: 'v1' });

    expect(leaderboard).toEqual([
      {
        variantId: 'v1',
        score: 0.75,
        status: 'completed'
      }
    ]);
    expect(fileStore.get('/.memory/leaderboard.json')).toBe(
      JSON.stringify([
        {
          variantId: 'v1',
          score: 0.75,
          status: 'completed'
        }
      ])
    );
  });

  it('routes generation through a remote swarm provider when no local model exists', async () => {
    const transportHandlers = new Map();
    const swarmTransport = {
      init: vi.fn(async () => true),
      onMessage: vi.fn((type, handler) => {
        transportHandlers.set(type, handler);
      }),
      sendToPeer: vi.fn((peerId, type, payload) => {
        if (type === 'reploid:generation-request') {
          setTimeout(() => {
            transportHandlers.get('reploid:generation-update')?.(peerId, {
              requestId: payload.requestId,
              chunk: 'remote partial'
            });
            transportHandlers.get('reploid:generation-result')?.(peerId, {
              requestId: payload.requestId,
              response: {
                content: 'remote final',
                raw: 'remote final',
                model: 'gemini-3.1-flash-lite-preview',
                provider: 'gemini'
              }
            });
          }, 0);
        }
        return true;
      }),
      broadcast: vi.fn(() => 1),
      getConnectionState: vi.fn(() => 'connected'),
      getTransportType: vi.fn(() => 'mock')
    };

    const bridge = createSelfBridge({
      swarmEnabled: true,
      swarmTransport
    });

    await bridge.initialize();
    transportHandlers.get('reploid:peer-advertisement')?.('peer-provider', {
      peerId: 'peer-provider',
      role: 'provider',
      swarmEnabled: true,
      hasInference: true,
      capabilities: ['generation'],
      contribution: {
        score: 2,
        uniquePeers: []
      }
    });

    const updates = [];
    const result = await bridge.generate(
      [{ role: 'user', content: 'Say hello' }],
      (chunk) => updates.push(chunk)
    );

    expect(bridge.hasAvailableProvider()).toBe(true);
    expect(result.content).toBe('remote final');
    expect(updates).toEqual(['remote partial']);
    expect(swarmTransport.sendToPeer).toHaveBeenCalledWith(
      'peer-provider',
      'reploid:generation-request',
      expect.objectContaining({
        consumer: expect.stringMatching(/^peer:/),
        messages: [{ role: 'user', content: 'Say hello' }]
      })
    );
  });
});
