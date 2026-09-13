import { createIndexedDbStore, createVfs } from '../vendor/reploid/adapters/browser.js';
import { getScopedReploidVfsDbName } from '../instance.js';
import profile from '../config/reploid-library.json' with { type: 'json' };

export default {
  metadata: { id: 'VFS', version: '1.0.0', genesis: { introduced: 'tabula' },
    dependencies: ['Utils', 'EventBus?'], async: true, type: 'service' },
  factory({ EventBus }) {
    const store = createIndexedDbStore({ ...profile.persistence, databaseName: getScopedReploidVfsDbName() });
    return { ...createVfs({ store, emit: (name, event) => EventBus?.emit(name, event) }),
      close: () => store.close() };
  }
};
