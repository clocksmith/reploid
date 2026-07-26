import { describe, expect, it, vi } from 'vitest';

import { createReploidDopplerRuntimeService } from '../../self/core/doppler-runtime-service.js';

const makeModule = () => {
  const sessions = [];
  const module = {
    DOPPLER_VERSION: '0.5.1',
    dr: {
      open: vi.fn(async (source) => {
        const session = {
          schema: 'doppler.scoped-session/v1',
          source,
          loaded: true,
          close: vi.fn(async () => {
            session.loaded = false;
          })
        };
        sessions.push(session);
        return session;
      })
    }
  };
  return { module, sessions };
};

describe('Reploid DopplerRuntimeService', () => {
  it('owns one scoped session and closes it idempotently', async () => {
    const fixture = makeModule();
    const service = createReploidDopplerRuntimeService({
      loadModule: async () => fixture.module
    });
    const first = await service.open({ scope: 'pool:model', source: 'model' });
    const second = await service.open({ scope: 'pool:model', source: 'model' });
    expect(second).toBe(first);
    expect(fixture.module.dr.open).toHaveBeenCalledTimes(1);
    await service.close('pool:model');
    await service.close('pool:model');
    expect(first.close).toHaveBeenCalledTimes(1);
  });

  it('keeps local, Poolday, and Zero ownership scopes independent', async () => {
    const fixture = makeModule();
    const service = createReploidDopplerRuntimeService({
      loadModule: async () => fixture.module
    });
    await service.open({ scope: 'local', source: 'text-model' });
    await service.open({ scope: 'pool:protein', source: 'esm-model' });
    expect(service.get('local').source).toBe('text-model');
    expect(service.get('pool:protein').source).toBe('esm-model');
  });

  it('fails closed on a mixed runtime version or legacy-only API', async () => {
    const wrong = createReploidDopplerRuntimeService({
      loadModule: async () => ({
        DOPPLER_VERSION: '0.4.16',
        dr: { open: vi.fn() }
      })
    });
    await expect(wrong.open({ source: 'model' })).rejects.toThrow('requires Doppler 0.5.1');

    const legacy = createReploidDopplerRuntimeService({
      loadModule: async () => ({
        DOPPLER_VERSION: '0.5.1',
        dr: { load: vi.fn() }
      })
    });
    await expect(legacy.open({ source: 'model' })).rejects.toThrow('does not expose the scoped dr.open API');
  });

  it('closes a session even when shutdown races an in-flight open', async () => {
    let release;
    const ready = new Promise((resolve) => {
      release = resolve;
    });
    const session = {
      schema: 'doppler.scoped-session/v1',
      loaded: true,
      close: vi.fn(async () => {
        session.loaded = false;
      })
    };
    const service = createReploidDopplerRuntimeService({
      loadModule: async () => ({
        DOPPLER_VERSION: '0.5.1',
        dr: {
          open: vi.fn(async () => {
            await ready;
            return session;
          })
        }
      })
    });
    const opening = service.open({ scope: 'pool:provider', source: 'model' });
    const closing = service.close('pool:provider');
    release();
    await Promise.all([opening, closing]);
    expect(service.get('pool:provider')).toBeNull();
    expect(session.close).toHaveBeenCalledTimes(1);
  });
});
