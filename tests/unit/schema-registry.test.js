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

  it('registers only CreateTool as a built-in Zero tool schema', async () => {
    const registry = await createRegistry('zero');

    expect(registry.getToolSchema('CreateTool').description).toContain('validates the candidate');
    expect(registry.getToolSchema('CreateTool').description).toContain('activation evidence');
    expect(registry.getToolSchema('CreateTool').description).toContain('installs to /self/tools');
    expect(registry.getToolSchema('CreateTool').description).toContain('loads the tool');
    expect(registry.getToolSchema('CreateTool').description).toContain('capabilities');
    expect(registry.getToolSchema('CreateTool').readOnly).toBe(false);
    expect(registry.getToolSchema('ReadFile')).toBeNull();
    expect(registry.getToolSchema('WriteFile')).toBeNull();
    expect(registry.getToolSchema('ListFiles')).toBeNull();
    expect(registry.getToolSchema('ListTools')).toBeNull();
    expect(registry.getToolSchema('Promote')).toBeNull();
    expect(registry.getToolSchema('ProposeSelfPatch')).toBeNull();
  });

  it('keeps broader file and promotion schemas registered outside Zero', async () => {
    const registry = await createRegistry('x');

    expect(registry.getToolSchema('ReadFile').description).toContain('Batch with up to 8 independent read-only calls');
    expect(registry.getToolSchema('WriteFile').description).toContain('Stage candidates under /shadow');
    expect(registry.getToolSchema('WriteFile').description).toContain('Use CreateTool for new Zero runtime tools');
    expect(registry.getToolSchema('WriteFile').description).not.toContain('ProposeSelfPatch');
    expect(registry.getToolSchema('WriteFile').description).toContain('JSON object content is serialized as JSON text');
    expect(registry.getToolSchema('Promote').description).toContain('replayPassed: true');
    expect(registry.getToolSchema('ProposeSelfPatch')).toBeNull();
  });
});
