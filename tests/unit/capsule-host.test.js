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
      }
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

import { createCapsuleHost } from '../../src/capsule/host.js';

describe('Capsule Host', () => {
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

    const host = createCapsuleHost({
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
});
