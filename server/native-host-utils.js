import { EventEmitter } from 'node:events';

export const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

export const events = () => {
  const emitter = new EventEmitter();
  return { emit: (...args) => emitter.emit(...args), on(name, handler) {
    emitter.on(name, handler); return () => emitter.off(name, handler);
  } };
};
