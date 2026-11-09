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

  it('does not construct a worker when cancellation occurs during spawn preparation', async () => {
    const Worker = vi.fn();
    vi.stubGlobal('Worker', Worker);
    const deps = makeDeps();
    const gate = Promise.withResolvers();
    deps.AuditLogger.logEvent.mockReturnValue(gate.promise);
    const manager = WorkerManagerModule.factory(deps);
    await manager.init({ workerTypes: { explore: { tools: [], defaultModelRole: 'fast' } } }, { id: 'test', provider: 'test' });
    const controller = new AbortController();
    const pending = manager.spawn({ type: 'explore', task: 'cancel before creation', signal: controller.signal });
    const assertion = expect(pending).rejects.toThrow('deadline');
    controller.abort(Error('deadline'));
    gate.resolve();
    await assertion;
    expect(Worker).not.toHaveBeenCalled();
    expect(manager.list()).toEqual([]);
  });

  it.each(['construction', 'dispatch'])('releases worker startup resources after %s fails', async failure => {
    const terminate = vi.fn();
    const error = Error(`${failure} failed`);
    let failing = true;
    let worker;
    vi.stubGlobal('Worker', class {
      constructor() {
        if (failing && failure === 'construction') throw error;
        worker = this;
      }
      terminate = terminate;
      postMessage() { if (failing) throw error; }
    });
    const deps = makeDeps();
    deps.TraceStore = {
      startSession: vi.fn().mockResolvedValueOnce('trace-startup').mockResolvedValue('trace-retry'),
      endSession: vi.fn().mockResolvedValue()
    };
    const manager = WorkerManagerModule.factory(deps);
    await manager.init({ workerTypes: { explore: { tools: [] } } }, { id: 'test', provider: 'test' });

    await expect(manager.spawn({ type: 'explore', task: 'startup failure' })).rejects.toBe(error);

    expect(manager.list()).toEqual([]);
    expect(terminate).toHaveBeenCalledTimes(failure === 'dispatch' ? 1 : 0);
    expect(deps.TraceStore.endSession).toHaveBeenCalledWith('trace-startup', expect.objectContaining({ status: 'error' }));

    failing = false;
    const result = await manager.spawn({ type: 'explore', task: 'retry after rollback' });
    expect(manager.list().map(record => record.workerId)).toEqual([result.workerId]);
    worker.onmessage({ data: { type: 'complete', result: 'done' } });
    await expect(result.promise).resolves.toBe('done');
    expect(manager.list()).toEqual([]);
    expect(deps.TraceStore.endSession).toHaveBeenCalledWith('trace-retry', expect.objectContaining({ status: 'completed' }));
  });

  it('closes a trace acquired after spawn cancellation without constructing a worker', async () => {
    const Worker = vi.fn();
    vi.stubGlobal('Worker', Worker);
    const deps = makeDeps();
    const trace = Promise.withResolvers();
    deps.TraceStore = { startSession: vi.fn().mockReturnValue(trace.promise), endSession: vi.fn().mockResolvedValue() };
    const manager = WorkerManagerModule.factory(deps);
    await manager.init({ workerTypes: { explore: { tools: [] } } }, { id: 'test', provider: 'test' });
    const controller = new AbortController();
    const pending = manager.spawn({ type: 'explore', task: 'cancel during trace creation', signal: controller.signal });
    const assertion = expect(pending).rejects.toThrow('deadline');
    await vi.waitFor(() => expect(deps.TraceStore.startSession).toHaveBeenCalled());
    controller.abort(Error('deadline'));
    trace.resolve('trace-cancelled');
    await assertion;

    expect(Worker).not.toHaveBeenCalled();
    expect(manager.list()).toEqual([]);
    expect(deps.TraceStore.endSession).toHaveBeenCalledWith('trace-cancelled', expect.objectContaining({ status: 'cancelled' }));
  });

  it('closes the trace of a spawn that loses concurrent admission during preparation', async () => {
    const workers = [];
    vi.stubGlobal('Worker', class {
      constructor() { workers.push(this); }
      postMessage() {}
      terminate() {}
    });
    const deps = makeDeps();
    const gates = Array.from({ length: 11 }, () => Promise.withResolvers());
    deps.TraceStore = {
      startSession: vi.fn().mockImplementation(() => gates[deps.TraceStore.startSession.mock.calls.length - 1].promise),
      endSession: vi.fn().mockResolvedValue()
    };
    const manager = WorkerManagerModule.factory(deps);
    await manager.init({ workerTypes: { explore: { tools: [] } } }, { id: 'test', provider: 'test' });
    const pending = gates.map(() => manager.spawn({ type: 'explore', task: 'concurrent admission' }));
    const settled = Promise.allSettled(pending);
    await vi.waitFor(() => expect(deps.TraceStore.startSession).toHaveBeenCalledTimes(11));
    gates.forEach((gate, index) => gate.resolve(`trace-${index}`));
    const results = await settled;

    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(workers).toHaveLength(10);
    expect(manager.list()).toHaveLength(10);
    expect(deps.TraceStore.endSession).toHaveBeenCalledWith('trace-10', expect.objectContaining({ status: 'error' }));
    manager.list().forEach(worker => manager.terminate(worker.workerId));
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
