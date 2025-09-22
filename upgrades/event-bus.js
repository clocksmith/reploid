// Event Bus Module for REPLOID - Project Phoenix
// A simple pub/sub system for decoupling modules.

const EventBus = {
  metadata: {
    id: 'EventBus',
    version: '1.0.0',
    dependencies: ['Utils'],
    async: false,
    type: 'service'
  },
  factory: (deps) => {
    const { Utils } = deps;
    const { logger } = Utils;
    
    const _listeners = new Map();

    const on = (eventName, listener) => {
      if (!_listeners.has(eventName)) {
        _listeners.set(eventName, []);
      }
      _listeners.get(eventName).push(listener);
      logger.debug(`[EventBus] Listener registered for event: ${eventName}`);
    };

    const off = (eventName, listenerToRemove) => {
      if (!_listeners.has(eventName)) {
        return;
      }
      const listeners = _listeners.get(eventName).filter(l => l !== listenerToRemove);
      _listeners.set(eventName, listeners);
      logger.debug(`[EventBus] Listener removed for event: ${eventName}`);
    };

    const emit = (eventName, data) => {
      logger.info(`[EventBus] Emitting event: ${eventName}`, data);
      if (!_listeners.has(eventName)) {
        return;
      }
      _listeners.get(eventName).forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          logger.error(`[EventBus] Error in listener for event ${eventName}:`, error);
        }
      });
    };

    return {
      api: {
        on,
        off,
        emit
      }
    };
  }
};

EventBus;
