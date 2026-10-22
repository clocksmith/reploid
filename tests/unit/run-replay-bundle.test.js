import { describe, expect, it, vi } from 'vitest';

import {
  RUN_REPLAY_SCHEMA,
  buildRunReplayBundle,
  collectReplayVfsFiles,
  deriveBootStateFromRunReplayBundle,
  formatRunReplayFilename,
  readImportedRunReplaySummary,
  validateRunReplayBundle,
  writeImportedRunReplaySummary
} from '../../self/core/run-replay-bundle.js';

describe('run replay bundle helpers', () => {
  it('validates replay JSON and redacts model secrets', () => {
    const bundle = validateRunReplayBundle({
      schema: RUN_REPLAY_SCHEMA,
      mode: 'zero',
      goal: 'Inspect the VFS',
      model: {
        id: 'gemini-3.1-flash-lite',
        provider: 'gemini',
        apiKey: 'secret'
      }
    });

    expect(bundle.goal).toBe('Inspect the VFS');
    expect(bundle.model.apiKey).toBe('[redacted]');
  });

  it('derives Zero proxy boot state from imported model metadata', () => {
    const { stateUpdates, storageModels, summary } = deriveBootStateFromRunReplayBundle({
      schema: RUN_REPLAY_SCHEMA,
      mode: 'zero',
      route: '/zero',
      goal: 'Replay this objective',
      models: [{
        id: 'gemini-3.1-flash-lite',
        name: 'Gemini',
        provider: 'gemini',
        hostType: 'proxy-cloud',
        proxyUrl: '/zero/gemini',
        serverType: 'firebase-function'
      }],
      vfs: {
        '/cycles/cycle-000001/toolcalls.json': '{}'
      }
    }, {
      proxyConfig: {
        verifyState: 'unverified',
        modelVerifyState: 'unverified'
      }
    });

    expect(stateUpdates).toMatchObject({
      goal: 'Replay this objective',
      connectionType: 'proxy',
      proxyConfig: {
        url: '/zero/gemini',
        provider: 'gemini',
        model: 'gemini-3.1-flash-lite'
      }
    });
    expect(storageModels[0]).toMatchObject({
      id: 'gemini-3.1-flash-lite',
      proxyUrl: '/zero/gemini'
    });
    expect(summary.files).toBe(1);
  });

  it('collects bounded replay VFS roots only', async () => {
    const files = {
      '/cycles/cycle-000001/toolcalls.json': '{"ok":true}',
      '/artifacts/evidence.json': '{"replayPassed":true}',
      '/self/runtime.js': 'do not export'
    };
    const VFS = {
      list: vi.fn(async (root) => Object.keys(files).filter((path) => path.startsWith(`${root}/`))),
      read: vi.fn(async (path) => files[path])
    };

    const exported = await collectReplayVfsFiles(VFS);

    expect(exported).toEqual({
      '/artifacts/evidence.json': '{"replayPassed":true}',
      '/cycles/cycle-000001/toolcalls.json': '{"ok":true}'
    });
    expect(exported['/self/runtime.js']).toBeUndefined();
  });

  it('round-trips an external run into an unverified credential-free selection', () => {
    const bundle = buildRunReplayBundle({
      mode: 'x',
      route: '/x',
      goal: 'Inspect the current workspace.',
      modelConfigs: [{
        id: 'external-brain',
        name: 'External brain',
        provider: 'external',
        hostType: 'direct',
        endpoint: 'https://untrusted.example/ignored',
        apiKey: 'ignored-secret'
      }],
      state: { externalConfig: { enabled: true, verifyState: 'verified' } }
    });
    const { stateUpdates, storageModels } = deriveBootStateFromRunReplayBundle(bundle, {
      mode: 'x',
      routeLockedMode: 'x',
      externalConfig: { enabled: true, verifyState: 'verified' }
    }, { externalBrainAvailable: true });

    expect(stateUpdates).toMatchObject({
      goal: 'Inspect the current workspace.',
      connectionType: 'external',
      externalConfig: { enabled: false, verifyState: 'unverified', verifyError: null }
    });
    expect(stateUpdates.directConfig).toBeUndefined();
    expect(stateUpdates.proxyConfig).toBeUndefined();
    expect(storageModels).toEqual([{
      id: 'external-brain', name: 'External brain', provider: 'external', hostType: 'direct'
    }]);
  });

  it.each([
    [{ id: 'another-model', provider: 'external', hostType: 'direct' }],
    [{ id: 'external-brain', provider: 'openai', hostType: 'direct' }],
    [{ id: 'external-brain', provider: 'external', hostType: 'proxy-cloud' }],
    [
      { id: 'external-brain', provider: 'external', hostType: 'direct' },
      { id: 'paid-model', provider: 'openai', hostType: 'browser-cloud' }
    ],
    [
      { id: 'paid-model', provider: 'openai', hostType: 'browser-cloud' },
      { id: 'external-brain', provider: 'external', hostType: 'direct' }
    ]
  ].map((models) => [models]))('rejects malformed or mixed external replay selections: %j', (models) => {
    expect(() => deriveBootStateFromRunReplayBundle({
      schema: RUN_REPLAY_SCHEMA,
      mode: 'x',
      goal: 'Inspect the workspace.',
      models
    }, { mode: 'x' }, { externalBrainAvailable: true })).toThrow('must select one');
  });

  it.each([
    ['zero', 'x', 'x', true],
    ['x', 'zero', 'zero', true],
    ['x', 'reploid', 'reploid', true],
    ['x', 'x', 'zero', true],
    ['x', 'x', 'x', false],
    ['x', 'x', 'x', undefined]
  ])('rejects external replay outside local X: bundle=%s, mode=%s, route=%s, available=%s', (
    mode, currentMode, routeLockedMode, externalBrainAvailable
  ) => {
    expect(() => deriveBootStateFromRunReplayBundle({
      schema: RUN_REPLAY_SCHEMA,
      mode,
      goal: 'Inspect the workspace.',
      models: [{ id: 'external-brain', provider: 'external', hostType: 'direct' }]
    }, {
      mode: currentMode,
      routeLockedMode
    }, { externalBrainAvailable })).toThrow('only on local X');
  });

  it('builds a replay-engine-compatible flat VFS bundle', () => {
    const bundle = buildRunReplayBundle({
      mode: 'zero',
      route: '/zero',
      goal: 'Build a probe',
      modelConfigs: [{ id: 'model-a', provider: 'proxy', apiKey: 'secret' }],
      systemPrompt: 'You are Zero',
      context: [{ role: 'user', content: 'Begin. Goal: Build a probe' }],
      activities: [{ kind: 'llm_response', cycle: 1, content: 'DONE' }],
      vfsFiles: {
        '/cycles/cycle-000001/toolcalls.json': '{"calls":[],"results":[]}',
        '/artifacts/probe.json': '{"ok":true}'
      }
    });

    expect(bundle.schema).toBe(RUN_REPLAY_SCHEMA);
    expect(bundle.vfs['/cycles/cycle-000001/toolcalls.json']).toContain('calls');
    expect(bundle.cycles['cycle-000001'].toolcalls).toEqual({ calls: [], results: [] });
    expect(bundle.model.apiKey).toBe('[redacted]');
    expect(bundle.replay.llmResponses[0]).toMatchObject({ cycle: 1, content: 'DONE' });
    expect(formatRunReplayFilename(bundle)).toMatch(/^reploid-zero-build-a-probe-/);
  });

  it('stores and reads a small imported replay summary', () => {
    const values = new Map();
    const storage = {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value)
    };

    const summary = writeImportedRunReplaySummary(storage, {
      schema: RUN_REPLAY_SCHEMA,
      mode: 'zero',
      goal: 'Replay import',
      model: { id: 'model-a' }
    });

    expect(summary.goal).toBe('Replay import');
    expect(readImportedRunReplaySummary(storage)).toMatchObject({
      schema: RUN_REPLAY_SCHEMA,
      goal: 'Replay import'
    });
  });
});
