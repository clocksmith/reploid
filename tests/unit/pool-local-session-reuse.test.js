import { describe, it, expect, vi } from 'vitest';
import { createLocalPackExecutor } from '../../self/pool/local-pack-executor.js';
import { createReploidDopplerRuntimeService } from '../../self/infrastructure/doppler-runtime-service.js';
import { createDocumentPackFixture } from '../fixtures/document-packs.js';
import defaults from '../../self/pool/local-session-policy.json' with { type: 'json' };

async function fixture(policy = defaults, prepareRelease) {
  const f = await createDocumentPackFixture({ schema: 'doppler.capsule/v2', runtimeVersion: '0.6.0' });
  const closes = [];
  const open = vi.fn(async () => {
    const close = vi.fn(); closes.push(close);
    return { ...await f.service.openCapsule(), close };
  });
  const service = createReploidDopplerRuntimeService({ expectedVersion: '0.6.0',
    loadModule: async () => ({ DOPPLER_VERSION: '0.6.0', openCapsule: open }) });
  const executor = createLocalPackExecutor({ service, sessionPolicy: policy, prepareRelease });
  const run = role => executor.run({ model: f.configuration[role],
    input: role === 'embedding' ? { texts: ['apple'], application: f.configuration.embedding.application }
      : role === 'reranker' ? { query: 'apple', documents: ['apple'], application: f.configuration.reranker.application }
      : { prompt: 'apple' }, options: role === 'generator' ? f.configuration.generationOptions : {},
    limits: { maxInputBytes: 10000, maxOutputBytes: 10000, deadlineAt: Date.now() + 10000 } });
  return { executor, run, open, closes };
}

describe('bounded idle model sessions (synthetic execution)', () => {
  it('reuses three exact models across successive answer cycles and closes every owned scope', async () => {
    const f = await fixture();
    for (let i = 0; i < 2; i++) for (const role of ['embedding', 'reranker', 'generator']) await f.run(role);
    expect(f.open).toHaveBeenCalledTimes(3);
    expect(f.closes.every(close => close.mock.calls.length === 0)).toBe(true);
    expect(f.executor.getState().metrics).toMatchObject({ modelLoads: 3, modelReuses: 3, modelSwitches: 5 });
    await f.executor.close();
    expect(f.closes.every(close => close.mock.calls.length === 1)).toBe(true);
    expect(f.executor.getState().memory.reservedBytes).toBe(0);
  });

  it('evicts the least recently used idle model before admitting a reservation over budget', async () => {
    const reservation = 4 * defaults.artifactBytesMultiplier + defaults.workingBytesPerSession;
    const f = await fixture({ ...defaults, maxReservedBytes: reservation * 2 });
    await f.run('embedding'); await f.run('reranker'); await f.run('embedding'); await f.run('generator');
    expect(f.closes[0]).not.toHaveBeenCalled();
    expect(f.closes[1]).toHaveBeenCalledOnce();
    expect(f.executor.getState().metrics).toMatchObject({ modelLoads: 3, modelReuses: 1, sessionEvictions: 1,
      peakReservedBytes: reservation * 2 });
    await f.run('reranker');
    expect(f.open).toHaveBeenCalledTimes(4);
    await f.executor.close();
  });

  it('rejects an oversized model before preparing or loading it', async () => {
    const f = await fixture({ ...defaults, maxReservedBytes: 1 });
    await expect(f.run('embedding')).rejects.toThrow('memory reservation budget');
    expect(f.open).not.toHaveBeenCalled();
    await f.executor.close();
  });

  it('rejects an unsupported option before acquiring a model session', async () => {
    const f = await createDocumentPackFixture({ schema: 'doppler.capsule/v2', runtimeVersion: '0.6.0' });
    const prepare = vi.spyOn(f.service, 'prepare');
    const executor = createLocalPackExecutor({ service: f.service });
    await expect(executor.run({ model: f.configuration.generator, input: { prompt: 'hello' },
      options: { ...f.configuration.generationOptions, undeclaredOption: true },
      limits: { maxInputBytes: 10000, maxOutputBytes: 10000, deadlineAt: Date.now() + 10000 } })).rejects.toMatchObject({ code: 'DOPPLER_GENERATION_INVALID_REQUEST' });
    expect(prepare).not.toHaveBeenCalled();
    await executor.close();
  });

  it('rechecks trust when selecting an idle model and drains every model after revocation', async () => {
    let revoked = false;
    const f = await fixture(defaults, async ({ model }) => ({ options: model.packOpenOptions,
      assertCurrent() { if (revoked) throw new Error('revoked'); }, close() {} }));
    await f.run('embedding'); await f.run('generator'); revoked = true;
    await expect(f.run('embedding')).rejects.toThrow('revoked');
    expect(f.open).toHaveBeenCalledTimes(2);
    expect(f.closes.every(close => close.mock.calls.length === 1)).toBe(true);
    expect(f.executor.getState().sessions).toEqual([]);
    await f.executor.close();
  });

  it('poisons an executor after a failed close while still cleaning other owned sessions', async () => {
    const f = await fixture();
    await f.run('embedding'); await f.run('generator');
    f.closes[0].mockRejectedValue(new Error('GPU release failed'));
    await expect(f.executor.close()).rejects.toThrow('cleanup failed');
    expect(f.closes[1]).toHaveBeenCalledOnce();
    await expect(f.run('embedding')).rejects.toThrow('closed');
  });
});
