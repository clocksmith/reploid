import { afterEach, describe, expect, it } from 'vitest';
import UtilsModule from '../../shared/core/utils.js';
import SubstrateLoaderModule from '../../self/capabilities/system/substrate-loader.js';
import { clearVfsModuleCache, getVfsModuleStats, resetVfsModuleStats } from '../../self/core/vfs-module-loader.js';

// LoadModule passes force to SubstrateLoader.loadModule, which used to drop it, so an unchanged
// module was always served from the loader's cache. (In Node the loader imports from a data URL
// that Node itself caches, so this asserts the loader's cache decision, not re-evaluation; in a
// browser each load gets a fresh blob URL.)
describe('SubstrateLoader.loadModule force', () => {
  afterEach(() => { clearVfsModuleCache(); resetVfsModuleStats(); });

  const setup = () => {
    const code = 'export default 1;\n';
    const VFS = { exists: async () => true, read: async () => code };
    const VerificationManager = { verifyProposal: async () => ({ passed: true, errors: [], warnings: [] }) };
    return SubstrateLoaderModule.factory({ Utils: UtilsModule.factory(), VFS, VerificationManager });
  };

  it('serves an unchanged module from the cache without force', async () => {
    const substrate = setup();
    resetVfsModuleStats();
    await substrate.loadModule('/self/widgets/Probe.js');
    await substrate.loadModule('/self/widgets/Probe.js');
    expect(getVfsModuleStats()).toMatchObject({ cacheMisses: 1, cacheHits: 1 });
  });

  it('bypasses the cache with force', async () => {
    const substrate = setup();
    resetVfsModuleStats();
    await substrate.loadModule('/self/widgets/Probe.js');
    await substrate.loadModule('/self/widgets/Probe.js', { force: true });
    expect(getVfsModuleStats()).toMatchObject({ cacheMisses: 2, cacheHits: 0 });
  });
});
