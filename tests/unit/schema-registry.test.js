import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SchemaRegistryModule from '../../core/schema-registry.js';

const createRegistry = async (mode = 'zero') => {
  vi.stubGlobal('window', {
    getReploidMode: () => mode
  });

  const registry = SchemaRegistryModule.factory({
    Utils: {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    },
    VFS: null,
    SchemaValidator: null
  });

  await registry.init();
  return registry;
};

describe('SchemaRegistry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks Zero discovery tools as native-call batch friendly', async () => {
    const registry = await createRegistry('zero');

    expect(registry.getToolSchema('ReadFile').description).toContain('Batch with up to 8 independent read-only calls');
    expect(registry.getToolSchema('ListFiles').description).toContain('Batch with up to 8 independent read-only calls');
    expect(registry.getToolSchema('ListTools').description).toContain('Batch with up to 8');
    expect(registry.getToolSchema('ReadFile').readOnly).toBe(true);
    expect(registry.getToolSchema('ListFiles').readOnly).toBe(true);
    expect(registry.getToolSchema('ListTools').readOnly).toBe(true);
  });

  it('tells native callers where build artifacts should be staged', async () => {
    const registry = await createRegistry('zero');

    expect(registry.getToolSchema('WriteFile').description).toContain('stage candidates under /shadow');
    expect(registry.getToolSchema('WriteFile').description).toContain('evidence JSON with replayPassed true under /artifacts');
    expect(registry.getToolSchema('WriteFile').description).toContain('JSON object content is serialized as JSON text');
    expect(registry.getToolSchema('Promote')).toBeNull();
    expect(registry.getToolSchema('CreateTool').description).toContain('installs to /self/tools');
    expect(registry.getToolSchema('CreateTool').description).toContain('loads the tool');
    expect(registry.getToolSchema('WriteFile').readOnly).toBe(false);
    expect(registry.getToolSchema('CreateTool').readOnly).toBe(false);
  });

  it('keeps Promote schema registered outside Zero', async () => {
    const registry = await createRegistry('x');

    expect(registry.getToolSchema('Promote').description).toContain('replayPassed: true');
  });
});
