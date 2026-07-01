import { describe, expect, it, vi } from 'vitest';

import { createGenesisSnapshot } from '../../self/boot-helpers/services.js';

describe('boot services', () => {
  const createLogger = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  });

  it('skips genesis snapshot creation when the module is not registered', async () => {
    const logger = createLogger();
    const container = {
      hasModule: vi.fn().mockReturnValue(false),
      resolve: vi.fn()
    };

    await createGenesisSnapshot(container, logger);

    expect(container.hasModule).toHaveBeenCalledWith('GenesisSnapshot');
    expect(container.resolve).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      '[Boot] Genesis snapshot skipped: GenesisSnapshot not registered for this genesis level'
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('creates a genesis snapshot when the module is registered', async () => {
    const logger = createLogger();
    const createSnapshot = vi.fn().mockResolvedValue(true);
    const container = {
      hasModule: vi.fn().mockReturnValue(true),
      resolve: vi.fn().mockResolvedValue({ createSnapshot })
    };

    await createGenesisSnapshot(container, logger);

    expect(container.resolve).toHaveBeenCalledWith('GenesisSnapshot');
    expect(createSnapshot).toHaveBeenCalledWith(expect.stringMatching(/^genesis-/), {
      includeApps: false,
      includeLogs: false
    });
    expect(logger.info).toHaveBeenCalledWith('[Boot] Genesis snapshot created - pristine state preserved');
  });

  it('warns when a registered genesis snapshot module fails', async () => {
    const logger = createLogger();
    const container = {
      hasModule: vi.fn().mockReturnValue(true),
      resolve: vi.fn().mockRejectedValue(new Error('snapshot unavailable'))
    };

    await createGenesisSnapshot(container, logger);

    expect(logger.warn).toHaveBeenCalledWith(
      '[Boot] Failed to create genesis snapshot:',
      'snapshot unavailable'
    );
  });
});
