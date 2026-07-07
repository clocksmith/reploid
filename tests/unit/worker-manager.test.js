import { afterEach, describe, expect, it, vi } from 'vitest';

import WorkerManagerModule from '../../self/core/worker-manager.js';

const makeDeps = () => ({
  Utils: {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }
  },
  VFS: {
    list: vi.fn().mockResolvedValue([]),
    read: vi.fn(),
    write: vi.fn().mockResolvedValue(true)
  },
  LLMClient: {
    chat: vi.fn()
  },
  ToolRunner: {
    setWorkerManager: vi.fn(),
    getToolSchemasFiltered: vi.fn().mockReturnValue([])
  },
  ResponseParser: {
    parseToolCalls: vi.fn().mockReturnValue([])
  },
  EventBus: {
    emit: vi.fn()
  },
  AuditLogger: {
    logEvent: vi.fn().mockResolvedValue(true)
  },
  SchemaRegistry: {
    registerWorkerTypes: vi.fn()
  },
  ToolExecutor: {
    executeWithRetry: vi.fn().mockResolvedValue({
      result: '{"ok":false,"reasons":["worker evidence failed"]}',
      rawResult: { ok: false, reasons: ['worker evidence failed'] },
      error: null,
      duration: 3
    })
  }
});

describe('WorkerManager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves rawResult in worker tool RPC responses', async () => {
    let fakeWorker = null;
    class FakeWorker {
      constructor() {
        fakeWorker = this;
        this.onmessage = null;
        this.onerror = null;
        this.rpcResponse = null;
      }

      postMessage(message) {
        if (message.type === 'start') {
          queueMicrotask(() => {
            this.onmessage?.({
              data: {
                type: 'rpc',
                workerId: message.workerId,
                requestId: 'rpc_1',
                op: 'tool:execute',
                payload: {
                  iteration: 1,
                  call: { name: 'Promote', args: { candidatePath: '/shadow/tools/Demo.js' } }
                }
              }
            });
          });
          return;
        }

        if (message.type === 'rpc:response') {
          this.rpcResponse = message;
          queueMicrotask(() => {
            this.onmessage?.({
              data: {
                type: 'complete',
                workerId: 'worker_1',
                result: { rpcPayload: message.payload }
              }
            });
          });
        }
      }

      terminate() {}
    }

    vi.stubGlobal('Worker', FakeWorker);
    const deps = makeDeps();
    const workerManager = WorkerManagerModule.factory(deps);
    await workerManager.init({
      workerTypes: {
        explore: { tools: ['Promote'], defaultModelRole: 'fast' }
      }
    }, { id: 'test-model', provider: 'test' });

    const { promise } = await workerManager.spawn({
      type: 'explore',
      task: 'promote a staged tool',
      maxIterations: 1
    });
    const result = await promise;

    expect(deps.ToolExecutor.executeWithRetry).toHaveBeenCalledWith(
      { name: 'Promote', args: { candidatePath: '/shadow/tools/Demo.js' } },
      expect.objectContaining({
        iteration: 1,
        allowedTools: ['Promote']
      })
    );
    expect(fakeWorker.rpcResponse.payload).toMatchObject({
      result: '{"ok":false,"reasons":["worker evidence failed"]}',
      rawResult: { ok: false, reasons: ['worker evidence failed'] },
      error: null
    });
    expect(result.rpcPayload.rawResult).toEqual({ ok: false, reasons: ['worker evidence failed'] });
  });
});
