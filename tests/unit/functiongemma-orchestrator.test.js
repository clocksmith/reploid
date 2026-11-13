// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createFunctionGemmaNetwork, evolveFunctionGemmaNetwork } from '../../self/core/functiongemma-network.js';
import Orchestrator from '../../self/core/functiongemma-orchestrator.js';
import { GENERATION_CONTRACT } from '../../shared/config/doppler-generation-contract.js';
import { createLabFunctionGemma } from '../../packages/reploid/src/agent/lab-strategy-function-gemma.js';
import { createScopedModelSession } from '../../shared/vendor/doppler/0.7.1/src/client/runtime/scoped-session.js';

vi.mock('../../self/core/doppler-runtime-service.js', async importOriginal => ({
  ...await importOriginal(), DopplerRuntimeService: { open: vi.fn(), close: vi.fn() }
}));
import { DopplerRuntimeService, createReploidDopplerRuntimeService } from '../../self/core/doppler-runtime-service.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function fixture(overrides = {}) {
  const calls = [];
  const session = {
    generationContract: GENERATION_CONTRACT,
    generate: async (prompt, options) => { calls.push(['generate', prompt, options]); return { outputText: prompt }; },
    loadLoRA: async source => { calls.push(['load', source]); },
    unloadLoRA: async () => { calls.push(['unload']); },
    get advanced() { throw new Error('Model has no advanced capability'); },
    ...overrides,
  };
  const service = { open: vi.fn(async () => session), close: vi.fn(async () => {}) };
  return { calls, session, service };
}

describe('FunctionGemma public session integration', () => {
  it('consumes the pinned Doppler scoped-session result through the real shared service', async () => {
    const close = vi.fn();
    const handle = { loaded: true, modelId: 'selected', unload: close,
      generateWithEvidence: async () => ({ outputText: 'public result', tokenIds: [],
        resolution: { logicalModelId: 'selected', resolvedArtifactVariantId: 'artifact', resolvedExecutionId: 'execution' } }) };
    const service = createReploidDopplerRuntimeService({ expectedVersion: null,
      loadModule: async () => ({ dr: { open: async () => createScopedModelSession(handle) } }) });
    const network = await createFunctionGemmaNetwork('selected', {}, service);
    network.registerExpert({ id: 'base' });
    expect(await network.executeExpert('base', 'prompt')).toBe('public result');
    await network.close(); expect(close).toHaveBeenCalledOnce();
  });

  it('keeps expert adapters and sampling identity separate and serializes a shared session', async () => {
    const gate = deferred(); let first = true;
    const f = fixture();
    f.session.generate = async (prompt, options) => { f.calls.push(['generate', prompt, options]); if (first) { first = false; await gate.promise; } return { content: prompt }; };
    const network = await createFunctionGemmaNetwork('selected-model', { generation: { temperature: 0, maxTokens: 4 } }, f.service);
    network.registerExpert({ id: 'a', adapterName: 'a', adapterSource: { id: 'adapter-a' } });
    network.registerExpert({ id: 'base' });
    const a = network.executeExpert('a', 'first', { maxTokens: undefined, topK: 3 });
    const base = network.executeExpert('base', 'second', { maxTokens: 8, generation: { topK: 20 } });
    await vi.waitFor(() => expect(f.calls.some(row => row[0] === 'generate')).toBe(true));
    expect(f.calls.map(row => row[0])).toEqual(['load', 'generate']);
    gate.resolve();
    expect(await Promise.all([a, base])).toEqual(['first', 'second']);
    expect(f.calls.map(row => row[0])).toEqual(['load', 'generate', 'unload', 'generate']);
    expect(f.calls[1][2]).toEqual({ temperature: 0, maxTokens: 4 });
    expect(f.calls[3][2]).toEqual({ temperature: 0, maxTokens: 8, topK: 20 });
    expect(f.service.open.mock.calls[0][0].source).toBe('selected-model');
    await network.close();
  });

  it('waits for in-flight work before cleanup and rejects queued cancelled work', async () => {
    const gate = deferred(); const f = fixture({ generate: async () => { await gate.promise; return { outputText: 'settled' }; } });
    const network = await createFunctionGemmaNetwork('model', {}, f.service);
    network.registerExpert({ id: 'base' });
    const first = network.executeExpert('base', 'first');
    await Promise.resolve();
    const controller = new AbortController();
    const second = network.executeExpert('base', 'second', { signal: controller.signal });
    const rejected = expect(second).rejects.toThrow();
    controller.abort(new Error('cancelled'));
    const closing = network.close();
    expect(f.service.close).not.toHaveBeenCalled();
    gate.resolve(); await first; await rejected; await closing;
    expect(f.service.close).toHaveBeenCalledTimes(1);
    await expect(network.executeExpert('base', 'after close')).rejects.toThrow('closed');
    await network.close(); expect(f.service.close).toHaveBeenCalledTimes(1);
  });

  it('preserves embedding ranking and weighted/voting text combinations', async () => {
    const f = fixture(); const network = await createFunctionGemmaNetwork('model', {}, f.service);
    network.registerExpert({ id: 'a', embedding: [1, 0] }); network.registerExpert({ id: 'b', embedding: [0, 1] });
    expect(network.selectExpertsByEmbedding([0, 1], 1)[0].id).toBe('b');
    network.setCombiner({ type: 'weighted', weights: [1, 2] }); expect(await network.combineOutputs(['a', 'b'])).toBe('b');
    network.setCombiner({ type: 'voting' }); expect(await network.combineOutputs(['a', 'b', 'a'])).toBe('a');
    await expect(network.executeExpert('missing', '')).rejects.toThrow('Unknown expert');
    expect(() => network.registerExpert({ id: 'bad', adapterName: 'missing' })).toThrow('adapterSource');
    await network.close();
  });

  it('rejects cancellation before activation and retries failed session cleanup', async () => {
    const f = fixture();
    f.service.close.mockRejectedValueOnce(new Error('release failed')).mockResolvedValue(undefined);
    const network = await createFunctionGemmaNetwork('model', {}, f.service);
    network.registerExpert({ id: 'base' });
    const controller = new AbortController(); controller.abort(new Error('cancelled'));
    await expect(network.executeExpert('base', 'prompt', { signal: controller.signal })).rejects.toThrow('cancelled');
    expect(f.calls).toEqual([]);
    await expect(network.close()).rejects.toThrow('release failed');
    await network.close(); expect(f.service.close).toHaveBeenCalledTimes(2);
  });

  it('opens via the shared public service and does not mutate context when prefix support is unavailable', async () => {
    const f = fixture(); DopplerRuntimeService.open.mockResolvedValue(f.session);
    const ContextManager = { initSharedPrefix: vi.fn(), registerExpertPrompt: vi.fn() };
    const logger = { info() {}, warn() {}, error() {} };
    const instance = Orchestrator.factory({ Utils: { logger, Errors: { ValidationError: Error, StateError: Error } }, ContextManager });
    const manifest = { modelId: 'selected-model' };
    const storageContext = { loadShard: vi.fn() };
    await instance.initBase({ manifest, baseUrl: '/models/selected', storageContext });
    expect(DopplerRuntimeService.open.mock.lastCall[0].source).toEqual({ manifest, baseUrl: '/models/selected', storageContext });
    await instance.registerExperts([{ id: 'base', promptSuffix: 'focus' }]);
    await expect(instance.initExpertContext('system', { id: 'qualified-model' })).rejects.toThrow('advanced capability');
    expect(ContextManager.initSharedPrefix).not.toHaveBeenCalled();
    expect(await instance.executeExpert('base', 'prompt')).toBe('prompt');
    await instance.close(); expect(DopplerRuntimeService.close).toHaveBeenCalled();
  });

  it('keeps topology evolution in the host and returns scored source genomes', async () => {
    await expect(evolveFunctionGemmaNetwork({})).rejects.toThrow('explicit random');
    const result = await evolveFunctionGemmaNetwork({ populationSize: 2, generations: 1, eliteCount: 1, mutationRate: 0,
      random: () => 0.2, randomGenome: () => ({ topology: { type: 'chain' }, nodes: [{ id: 'a' }], edges: [] }), evaluate: async genome => genome.nodes.length });
    expect(result.score).toBe(1); expect(result.genome.nodes[0].id).toBe('a');
    expect(result.population).toHaveLength(2);
    expect(result.population[0].fitness).toBe(result.score);
  });

  it('persists the evaluated arena population rather than looking for scores on a bare genome', async () => {
    const f = fixture(); DopplerRuntimeService.open.mockResolvedValue(f.session);
    const storeNetworkGenome = vi.fn();
    const instance = Orchestrator.factory({ Utils: { logger: { info() {}, warn() {} }, Errors: { ValidationError: Error, StateError: Error } },
      ReflectionStore: { storeNetworkGenome } });
    await instance.initBase({ modelId: 'selected' }); await instance.registerExperts([{ id: 'base' }]);
    const result = await instance.runArenaEvolution([{ type: 'task', prompt: 'output' }], {
      random: () => 0.2, populationSize: 2, eliteCount: 1, generations: 0, persistCount: 1
    });
    expect(result.rankings).toHaveLength(1);
    expect(result.winner.fitness).toBe(0.4); // Existing no-schema heuristic, not a quality measurement.
    expect(storeNetworkGenome).toHaveBeenCalledWith('task', result.winner.genome, result.winner.fitness);
    await instance.close();
  });

  it('waits for initialization and cleanup when a model changes and never republishes stale readiness', async () => {
    const opening = deferred(), closeGate = deferred(), events = [];
    const orchestrator = {
      initBase: vi.fn(async () => { events.push('open'); if (events.length === 1) await opening.promise; }),
      registerExperts: vi.fn(),
      close: vi.fn(async () => { events.push('close'); await closeGate.promise; })
    };
    const loop = { modelConfig: {}, policy: { legacyAgent: { settings: {} } } };
    const logger = { warn() {}, error() {} };
    const host = createLabFunctionGemma({ deps: { Utils: { logger }, FunctionGemmaOrchestrator: orchestrator }, loop });
    const config = { modelId: 'first', experts: [{ id: 'base' }], useSharedPrefix: false };
    const old = host.ensureFunctionGemmaReady([], config);
    await vi.waitFor(() => expect(events).toEqual(['open']));
    const closing = host.resetFunctionGemmaState();
    const next = host.ensureFunctionGemmaReady([], { ...config, modelId: 'next' });
    opening.resolve(); expect(await old).toBe(false);
    await vi.waitFor(() => expect(events).toEqual(['open', 'close']));
    expect(host.isReady()).toBe(false);
    closeGate.resolve(); await closing;
    expect(await next).toBe(true);
    expect(events).toEqual(['open', 'close', 'open']);
    expect(orchestrator.registerExperts).toHaveBeenCalledTimes(1);
    await host.resetFunctionGemmaState();
  });
});
