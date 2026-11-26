/**
 * @fileoverview Unit tests for the real StateManager (self/core/state-manager.js).
 *
 * This file used to test a StateManager written inside the test, with an artifact API the
 * module does not have. These cases run the module itself with the real StateHelpersPure and an
 * in-memory VFS.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import StateManagerModule from '../../self/core/state-manager.js';
import StateHelpersPureModule from '../../self/core/state-helpers-pure.js';

const STATE_PATH = '/.system/state.json';

const makeVFS = (initial = {}) => {
  const files = new Map(Object.entries(initial));
  return {
    files,
    read: vi.fn(async path => {
      if (!files.has(path)) throw new Error(`missing ${path}`);
      return files.get(path);
    }),
    write: vi.fn(async (path, content) => { files.set(path, content); return true; })
  };
};

const makeUtils = () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  Errors: { StateError: class StateError extends Error {} },
  generateId: vi.fn(prefix => `${prefix}_1`)
});

describe('StateManager', () => {
  let VFS;
  let Utils;
  let EventBus;
  let AuditLogger;

  const compose = () => StateManagerModule.factory({
    Utils,
    VFS,
    StateHelpersPure: StateHelpersPureModule.factory(),
    EventBus,
    AuditLogger
  });

  beforeEach(() => {
    VFS = makeVFS();
    Utils = makeUtils();
    EventBus = { emit: vi.fn() };
    AuditLogger = { logAgentAction: vi.fn() };
  });

  describe('init', () => {
    it('creates and saves a fresh state when none is stored', async () => {
      const state = await compose().init();
      expect(state).toMatchObject({ totalCycles: 0, currentGoal: null, session: { status: 'idle' } });
      expect(JSON.parse(VFS.files.get(STATE_PATH))).toMatchObject({ totalCycles: 0 });
    });

    it('loads a stored state and keeps defaults for missing fields', async () => {
      VFS = makeVFS({ [STATE_PATH]: JSON.stringify({ totalCycles: 7, session: { id: 's1' } }) });
      const state = await compose().init();
      expect(state.totalCycles).toBe(7);
      expect(state.session).toEqual({ id: 's1', startTime: null, status: 'idle' });
      expect(state.stats).toEqual({ apiCalls: 0, errors: 0 });
    });

    it('resets an invalid stored state instead of using it', async () => {
      VFS = makeVFS({ [STATE_PATH]: JSON.stringify({ totalCycles: 'many' }) });
      const state = await compose().init();
      expect(state.totalCycles).toBe(0);
      expect(Utils.logger.warn).toHaveBeenCalled();
    });

    it('starts fresh when the stored state is not JSON', async () => {
      VFS = makeVFS({ [STATE_PATH]: '{not json' });
      const state = await compose().init();
      expect(state.totalCycles).toBe(0);
    });
  });

  describe('getState', () => {
    it('throws before init', () => {
      expect(() => compose().getState()).toThrow('StateManager not initialized');
    });

    it('returns a copy, so callers cannot change the stored state', async () => {
      const manager = compose();
      await manager.init();
      const copy = manager.getState();
      copy.totalCycles = 99;
      expect(manager.getState().totalCycles).toBe(0);
    });
  });

  describe('updateState', () => {
    it('merges updates and persists them', async () => {
      const manager = compose();
      await manager.init();
      const next = await manager.updateState({ session: { id: 's2', startTime: 1, status: 'running' } });
      expect(next.session.status).toBe('running');
      expect(JSON.parse(VFS.files.get(STATE_PATH)).session.id).toBe('s2');
    });

    it('loads the stored state first when called before init', async () => {
      VFS = makeVFS({ [STATE_PATH]: JSON.stringify({ totalCycles: 3 }) });
      const next = await compose().updateState({ currentGoal: null });
      expect(next.totalCycles).toBe(3);
    });
  });

  describe('setGoal', () => {
    it('sets the first goal, then adds later goals as subgoals', async () => {
      const manager = compose();
      await manager.init();
      await manager.setGoal('Build the parser');
      await manager.setGoal('Write its tests');
      const { currentGoal } = manager.getState();
      expect(currentGoal.text).toBe('Build the parser');
      expect(currentGoal.subgoals).toHaveLength(1);
      expect(currentGoal.subgoals[0]).toMatchObject({ text: 'Write its tests', status: 'pending' });
      expect(JSON.parse(VFS.files.get(STATE_PATH)).currentGoal.subgoals).toHaveLength(1);
    });

    it('emits goal:set and records the action', async () => {
      const manager = compose();
      await manager.init();
      await manager.setGoal('Ship it');
      expect(EventBus.emit).toHaveBeenCalledWith('goal:set', expect.objectContaining({ goal: 'Ship it' }));
      expect(AuditLogger.logAgentAction).toHaveBeenCalledWith('SET_GOAL', 'StateManager', { goal: 'Ship it' });
    });
  });

  describe('incrementCycle', () => {
    it('counts cycles and persists the count', async () => {
      const manager = compose();
      await manager.init();
      await manager.incrementCycle();
      await manager.incrementCycle();
      expect(manager.getState().totalCycles).toBe(2);
      expect(JSON.parse(VFS.files.get(STATE_PATH)).totalCycles).toBe(2);
    });
  });

  describe('save failures', () => {
    it('retries a failed write and reports a persistence error when every attempt fails', async () => {
      vi.useFakeTimers();
      const manager = compose();
      await manager.init();
      VFS.write.mockRejectedValue(new Error('disk full'));
      const pending = manager.updateState({ currentGoal: null });
      await vi.runAllTimersAsync();
      await pending;
      expect(VFS.write).toHaveBeenCalledTimes(1 + 3); // the init save, then one attempt and two retries
      expect(EventBus.emit).toHaveBeenCalledWith('error:persistence', expect.objectContaining({ details: 'disk full' }));
      vi.useRealTimers();
    });
  });
});
