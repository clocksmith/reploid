import { createToolRunner } from '../shared/vendor/reploid/agent/tool-runner.js';
import { loadVfsModule } from './core/vfs-module-loader.js';
import { resolveSelfAuthorization } from './tool-authorization.js';

export function createSelfToolRunner(options = {}) {
  return createToolRunner({ ...options, loadModule: loadVfsModule,
    authorize: resolveSelfAuthorization(options.authorize) });
}

export default { createSelfToolRunner };
