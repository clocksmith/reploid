import { describe, expect, it } from 'vitest';
import { acquireChatHistoryOwner } from '../../self/host/chat-history.js';

// A minimal Web Locks stand-in: one exclusive lock per name, queued waiters, abortable.
function fakeLocks() {
  const held = new Map();
  const waiters = new Map();
  const grant = (name, callback) => {
    held.set(name, true);
    return Promise.resolve(callback({ name })).finally(() => {
      held.delete(name);
      const next = waiters.get(name)?.shift();
      next?.();
    });
  };
  return {
    request(name, options, callback) {
      if (!held.get(name)) return grant(name, callback);
      if (options.ifAvailable) return Promise.resolve(callback(null));
      return new Promise((resolve, reject) => {
        const start = () => grant(name, callback).then(resolve, reject);
        waiters.set(name, [...(waiters.get(name) || []), start]);
        options.signal?.addEventListener('abort', () => {
          waiters.set(name, (waiters.get(name) || []).filter(entry => entry !== start));
          reject(options.signal.reason);
        });
      });
    }
  };
}

describe('chat history ownership', () => {
  it('waits for a lock that a closing tab still holds', async () => {
    const locks = fakeLocks();
    const closing = await acquireChatHistoryOwner({ name: 'h', locks, waitMs: 0 });
    expect(closing).toBeTypeOf('function');
    const opening = acquireChatHistoryOwner({ name: 'h', locks, waitMs: 1000 });
    setTimeout(closing, 20);
    expect(await opening).toBeTypeOf('function');
  });

  it('refuses a second tab while the owner stays open', async () => {
    const locks = fakeLocks();
    const owner = await acquireChatHistoryOwner({ name: 'h', locks });
    expect(await acquireChatHistoryOwner({ name: 'h', locks, waitMs: 30 })).toBeNull();
    expect(await acquireChatHistoryOwner({ name: 'h', locks, waitMs: 0 })).toBeNull();
    owner();
  });
});
