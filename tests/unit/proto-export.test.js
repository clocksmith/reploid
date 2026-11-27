import { expect, it, vi } from 'vitest';
import UtilsModule from '../../shared/core/utils.js';
import EventBusModule from '../../shared/infrastructure/event-bus.js';
import ErrorStoreModule from '../../self/infrastructure/error-store.js';
import Proto from '../../self/ui/proto/index.js';

it('records a failed operator export in the error store', async () => {
  const Utils = {
    ...UtilsModule.factory(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  };
  const EventBus = EventBusModule.factory({ Utils });
  const VFS = { exists: async () => false, write: vi.fn() };
  const ErrorStore = ErrorStoreModule.factory({ Utils, VFS, EventBus });
  const StateManager = { getState: () => ({}) };
  const proto = Proto.factory({ Utils, EventBus, StateManager, ErrorStore });
  const root = document.createElement('div');
  document.body.appendChild(root);
  vi.stubGlobal('downloadReploid', vi.fn().mockRejectedValue(new Error('Export unavailable')));

  try {
    await proto.mount(root);
    const recorded = new Promise(resolve => EventBus.on('error:added', resolve));
    await root.querySelector('#btn-export').onclick();

    await expect(recorded).resolves.toMatchObject({
      type: 'agent:error',
      message: 'Export Failed',
      details: { error: 'Export unavailable' }
    });
    expect(VFS.write).toHaveBeenCalledWith('/.system/errors.json', expect.stringContaining('Export unavailable'));
  } finally {
    proto.cleanup();
    root.remove();
    vi.unstubAllGlobals();
  }
});
