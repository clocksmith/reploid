import { createToolRunner } from './vendor/reploid/index.js';
import { loadVfsModule } from './core/vfs-module-loader.js';

export function createSelfToolRunner(options = {}) {
  return createToolRunner({ ...options, loadModule: loadVfsModule,
    authorize: options.authorize || (() => true) });
}

export default { createSelfToolRunner };
