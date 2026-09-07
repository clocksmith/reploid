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
  it('prepares a Capsule-only public module without requiring a legacy API', async () => {
    const session = { schema: 'doppler.capsule-session/v1', loaded: true, close: vi.fn() };
    const module = { DOPPLER_VERSION: '0.6.0', openCapsule: vi.fn(async () => session) };
    const service = createReploidDopplerRuntimeService({ loadModule: async () => module, expectedVersion: '0.6.0' });
    await expect(service.prepare(null, { bindingSchema: 'doppler.capsule/v3' })).resolves.toEqual({ ok: true, version: '0.6.0' });
    await expect(service.openCapsule({ source: 'signed-capsule' })).resolves.toBe(session);
    await expect(service.openPack({ source: 'old-pack' })).rejects.toThrow('public openPack');
    await expect(service.prepare(null, { bindingSchema: 'doppler.capsule/v99' })).rejects.toThrow('Unsupported');
    expect(module.openCapsule).toHaveBeenCalledTimes(1);
    expect(service.get()).toBe(session);
    await service.closeAll();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('closes a wrongly formatted session instead of reinterpreting its identity', async () => {
    const session = { schema: 'doppler.pack-session/v1', loaded: true, close: vi.fn() };
    const service = createReploidDopplerRuntimeService({ expectedVersion: '0.6.0',
      loadModule: async () => ({ DOPPLER_VERSION: '0.6.0', openCapsule: async () => session }) });
    await expect(service.openCapsule({ source: 'signed-capsule' })).rejects.toThrow('invalid signed model session');
    expect(session.close).toHaveBeenCalledTimes(1);
    expect(service.get()).toBeNull();
  });

  it('serializes signed session replacement across both formats in the same scope', async () => {
    const oldSession = { schema: 'doppler.pack-session/v1', loaded: true, close: vi.fn() };
    const newSession = { schema: 'doppler.capsule-session/v1', loaded: true, close: vi.fn() };
    const service = createReploidDopplerRuntimeService({ expectedVersion: '0.6.0', loadModule: async () => ({
      DOPPLER_VERSION: '0.6.0', openPack: async () => oldSession, openCapsule: async () => newSession
    }) });
    const sessions = await Promise.all([service.openPack({ source: 'pack' }), service.openCapsule({ source: 'capsule' })]);
    expect(sessions).toEqual([oldSession, newSession]);
    expect(oldSession.close).toHaveBeenCalledTimes(1);
    expect(service.get()).toBe(newSession);
    await service.closeAll();
    expect(newSession.close).toHaveBeenCalledTimes(1);
  });

  it('opens signed Packs without legacy fallback or stale session reuse', async () => {
    const fixture = makeModule();
    const service = createReploidDopplerRuntimeService({ loadModule: async () => fixture.module });
    await expect(service.openPack({ source: 'pack' })).rejects.toThrow('cannot fall back');
    expect(fixture.module.dr.open).not.toHaveBeenCalled();
    fixture.module.dr.openPack = vi.fn(async () => ({ schema: 'doppler.pack-session/v1', loaded: true, close: vi.fn() }));
    const policy = { acceptedTargetPlanDigests: ['exact-plan'] };
    const first = await service.openPack({ scope: 'pool', source: 'pack', options: policy });
    const second = await service.openPack({ scope: 'pool', source: 'pack', options: policy });
    expect(first).not.toBe(second);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(fixture.module.dr.openPack).toHaveBeenLastCalledWith('pack', policy);
    await service.closeAll();
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent Pack replacements in one scope', async () => {
    const fixture = makeModule();
    fixture.module.dr.openPack = vi.fn(async (source) => ({ schema: 'doppler.pack-session/v1', source, loaded: true, close: vi.fn() }));
    const service = createReploidDopplerRuntimeService({ loadModule: async () => fixture.module });
    const [first, second] = await Promise.all([service.openPack({ source: 'first' }), service.openPack({ source: 'second' })]);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(service.get()).toBe(second);
    await service.closeAll();
  });

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
