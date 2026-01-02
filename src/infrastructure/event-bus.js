/**
 * @fileoverview Event Bus
 * Pub/Sub system with subscription tracking.
 */

const EventBus = {
  metadata: {
    id: 'EventBus',
    version: '1.0.0',
    genesis: { introduced: 'seed' },
    dependencies: ['Utils'],
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { logger, createSubscriptionTracker } = deps.Utils;
    const _listeners = new Map();
    const _tracker = createSubscriptionTracker();

    const on = (event, fn, ownerId = null) => {
      if (!_listeners.has(event)) _listeners.set(event, new Set());
      _listeners.get(event).add(fn);

      const unsub = () => {
        const set = _listeners.get(event);
        if (set) {
          set.delete(fn);
          // Clean up empty Sets to prevent memory leak
          if (set.size === 0) {
            _listeners.delete(event);
          }
        }
      };

      if (ownerId) _tracker.track(ownerId, unsub);
      return unsub;
    };

    const emit = (event, data) => {
      // logger.debug(`[Event] ${event}`, data); // Uncomment for verbose debugging
      const set = _listeners.get(event);
      if (set) {
        for (const fn of set) {
          try { fn(data); } catch (e) { logger.error(`[EventBus] Error in ${event}`, e); }
        }
      }
    };

    const unsubscribeModule = (moduleId) => {
      _tracker.unsubscribeAll(moduleId);
      logger.debug(`[EventBus] Unsubscribed module: ${moduleId}`);
    };

    return { on, emit, unsubscribeModule };
  }
};

export default EventBus;
