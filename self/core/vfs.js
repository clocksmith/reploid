import { createIndexedDbStore, createVfs } from '../vendor/reploid/adapters/browser.js';
import { getScopedReploidVfsDbName } from '../instance.js';
import profile from '../config/reploid-library.json' with { type: 'json' };

export default {
  metadata: { id: 'VFS', version: '1.0.0', genesis: { introduced: 'tabula' },
    dependencies: ['Utils', 'EventBus?'], async: true, type: 'service' },
  factory({ Utils, EventBus }) {
    const store = createIndexedDbStore({ ...profile.persistence, databaseName: getScopedReploidVfsDbName() });
    const vfs = createVfs({ store, emit: (name, event) => {
      if (name === 'vfs:file_changed' && event.operation === 'delete') Utils?.logger.info(`[VFS] Deleted ${event.path}`);
      EventBus?.emit(name, event);
    } });
    let initialized = false;
    return {
      ...vfs,
      async init() {
        await vfs.init();
        if (!initialized) { initialized = true; Utils?.logger.info('[VFS] Database connected'); }
        return true;
      },
      async mkdir(path) {
        await vfs.mkdir(path);
        Utils?.logger.debug(`[VFS] mkdir ${path} (virtual)`);
        return true;
      },
      close: () => store.close()
    };
  }
};
