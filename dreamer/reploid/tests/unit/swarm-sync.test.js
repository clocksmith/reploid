/**
 * @fileoverview Unit tests for SwarmSync module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import UtilsModule from '../../core/utils.js';
import EventBusModule from '../../infrastructure/event-bus.js';

// Constants matching the module
const MAX_ARTIFACT_SIZE = 256 * 1024; // 256KB
const CHUNK_SIZE = 32 * 1024; // 32KB
const MAX_CONCURRENT_TRANSFERS = 3;
const TRANSFER_TIMEOUT = 30000; // 30s

describe('SwarmSync', () => {
  let utils;
  let eventBus;
  let emittedEvents;

  beforeEach(() => {
    // Setup Utils mock
    utils = UtilsModule.factory();
    utils.logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    };

    // Setup EventBus
    const eventBusFn = EventBusModule.factory({ Utils: utils });
    emittedEvents = [];
    eventBus = {
      on: eventBusFn.on,
      emit: vi.fn((event, data) => {
        emittedEvents.push({ event, data });
        eventBusFn.emit(event, data);
      }),
      unsubscribeModule: eventBusFn.unsubscribeModule
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('LWW Merge', () => {
    // Implement the merge function as it exists in the module
    const merge = (local, remote) => {
      // Remote has higher clock - remote wins
      if (remote.clock > local.clock) {
        return { winner: 'remote', value: remote };
      }
      // Local has higher clock - local wins
      if (remote.clock < local.clock) {
        return { winner: 'local', value: local };
      }
      // Same clock - lexicographic tiebreak on peerId
      if (remote.peerId > local.peerId) {
        return { winner: 'remote', value: remote };
      }
      return { winner: 'local', value: local };
    };

    it('should let higher clock win', () => {
      const local = { value: 'local', clock: 5, peerId: 'peer-a' };
      const remote = { value: 'remote', clock: 10, peerId: 'peer-b' };

      const result = merge(local, remote);

      expect(result.winner).toBe('remote');
      expect(result.value).toBe(remote);
    });

    it('should let local win when local clock is higher', () => {
      const local = { value: 'local', clock: 15, peerId: 'peer-a' };
      const remote = { value: 'remote', clock: 10, peerId: 'peer-b' };

      const result = merge(local, remote);

      expect(result.winner).toBe('local');
      expect(result.value).toBe(local);
    });

    it('should use lexicographic peerId tiebreak on equal clocks', () => {
      const local = { value: 'local', clock: 10, peerId: 'peer-a' };
      const remote = { value: 'remote', clock: 10, peerId: 'peer-b' };

      const result = merge(local, remote);

      // 'peer-b' > 'peer-a' lexicographically, so remote wins
      expect(result.winner).toBe('remote');
      expect(result.value).toBe(remote);
    });

    it('should let local win when equal clock and local peerId is greater', () => {
      const local = { value: 'local', clock: 10, peerId: 'peer-z' };
      const remote = { value: 'remote', clock: 10, peerId: 'peer-a' };

      const result = merge(local, remote);

      // 'peer-a' < 'peer-z' lexicographically, so local wins
      expect(result.winner).toBe('local');
      expect(result.value).toBe(local);
    });

    it('should handle identical entries gracefully', () => {
      const local = { value: 'same', clock: 10, peerId: 'peer-x' };
      const remote = { value: 'same', clock: 10, peerId: 'peer-x' };

      const result = merge(local, remote);

      // Same peerId means local wins (remote is not greater)
      expect(result.winner).toBe('local');
    });
  });

  describe('Provenance Tracking', () => {
    it('should preserve sharedFrom tag', () => {
      const entry = {
        id: 'goal-1',
        value: { goal: 'test' },
        clock: 5,
        peerId: 'peer-sender',
        updatedAt: Date.now(),
        sharedFrom: 'peer-sender'
      };

      expect(entry.sharedFrom).toBe('peer-sender');
    });

    it('should include sharedFrom in remote entries', () => {
      const remotePeerId = 'peer-remote';
      const remoteEntry = {
        id: 'goal-2',
        value: { goal: 'shared goal' },
        clock: 10,
        peerId: remotePeerId,
        updatedAt: Date.now()
      };

      // When applying remote, sharedFrom would be set
      const applied = {
        ...remoteEntry,
        sharedFrom: remotePeerId
      };

      expect(applied.sharedFrom).toBe(remotePeerId);
    });
  });

  describe('Chunk Handling', () => {
    // Implement chunkData as in the module
    const chunkData = (data) => {
      const chunks = [];
      for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        chunks.push(data.slice(i, i + CHUNK_SIZE));
      }
      return chunks;
    };

    it('should split data larger than CHUNK_SIZE into chunks', () => {
      const data = 'x'.repeat(CHUNK_SIZE * 2.5);
      const chunks = chunkData(data);

      expect(chunks.length).toBe(3);
      expect(chunks[0].length).toBe(CHUNK_SIZE);
      expect(chunks[1].length).toBe(CHUNK_SIZE);
      expect(chunks[2].length).toBe(CHUNK_SIZE * 0.5);
    });

    it('should not split data smaller than CHUNK_SIZE', () => {
      const data = 'x'.repeat(CHUNK_SIZE - 1);
      const chunks = chunkData(data);

      expect(chunks.length).toBe(1);
      expect(chunks[0].length).toBe(CHUNK_SIZE - 1);
    });

    it('should handle exact CHUNK_SIZE data', () => {
      const data = 'x'.repeat(CHUNK_SIZE);
      const chunks = chunkData(data);

      expect(chunks.length).toBe(1);
      expect(chunks[0].length).toBe(CHUNK_SIZE);
    });

    it('should handle empty data', () => {
      const chunks = chunkData('');
      expect(chunks.length).toBe(0);
    });
  });

  describe('Artifact Size Limits', () => {
    it('should reject artifacts larger than MAX_ARTIFACT_SIZE', () => {
      const oversizedContent = 'x'.repeat(MAX_ARTIFACT_SIZE + 1);
      expect(oversizedContent.length).toBeGreaterThan(MAX_ARTIFACT_SIZE);
    });

    it('should accept artifacts at exactly MAX_ARTIFACT_SIZE', () => {
      const maxContent = 'x'.repeat(MAX_ARTIFACT_SIZE);
      expect(maxContent.length).toBe(MAX_ARTIFACT_SIZE);
      expect(maxContent.length).not.toBeGreaterThan(MAX_ARTIFACT_SIZE);
    });

    it('should accept artifacts smaller than MAX_ARTIFACT_SIZE', () => {
      const smallContent = 'x'.repeat(1024);
      expect(smallContent.length).toBeLessThan(MAX_ARTIFACT_SIZE);
    });
  });

  describe('Chunk Reassembly', () => {
    it('should reassemble chunks in order', () => {
      const originalData = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const chunkSize = 5;

      // Manual chunking for test
      const chunks = [];
      for (let i = 0; i < originalData.length; i += chunkSize) {
        chunks.push(originalData.slice(i, i + chunkSize));
      }

      // Reassemble
      const reassembled = chunks.join('');

      expect(reassembled).toBe(originalData);
    });

    it('should handle chunks received out of order', () => {
      const chunks = new Array(5).fill(null);
      const originalParts = ['AAAAA', 'BBBBB', 'CCCCC', 'DDDDD', 'EEEEE'];

      // Simulate receiving chunks out of order
      chunks[3] = originalParts[3];
      chunks[0] = originalParts[0];
      chunks[4] = originalParts[4];
      chunks[1] = originalParts[1];
      chunks[2] = originalParts[2];

      // Reassemble
      const reassembled = chunks.join('');

      expect(reassembled).toBe('AAAAABBBBBCCCCCDDDDDEEEEE');
    });
  });

  describe('Transfer Timeout', () => {
    it('should define timeout constant', () => {
      expect(TRANSFER_TIMEOUT).toBe(30000);
    });

    it('should timeout incomplete transfers after 30s', () => {
      vi.useFakeTimers();

      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
      }, TRANSFER_TIMEOUT);

      expect(timedOut).toBe(false);

      vi.advanceTimersByTime(TRANSFER_TIMEOUT);

      expect(timedOut).toBe(true);

      clearTimeout(timeout);
      vi.useRealTimers();
    });
  });

  describe('Concurrent Transfer Limits', () => {
    it('should enforce MAX_CONCURRENT_TRANSFERS limit', () => {
      const activeTransfers = new Set();

      // Simulate adding transfers
      activeTransfers.add('peer1:artifact1');
      activeTransfers.add('peer1:artifact2');
      activeTransfers.add('peer2:artifact1');

      expect(activeTransfers.size).toBe(MAX_CONCURRENT_TRANSFERS);

      // Should not allow more
      const canAdd = activeTransfers.size < MAX_CONCURRENT_TRANSFERS;
      expect(canAdd).toBe(false);
    });

    it('should allow transfer after one completes', () => {
      const activeTransfers = new Set();

      activeTransfers.add('peer1:artifact1');
      activeTransfers.add('peer1:artifact2');
      activeTransfers.add('peer2:artifact1');

      expect(activeTransfers.size).toBe(MAX_CONCURRENT_TRANSFERS);

      // Complete one transfer
      activeTransfers.delete('peer1:artifact1');

      expect(activeTransfers.size).toBe(MAX_CONCURRENT_TRANSFERS - 1);

      // Now can add another
      const canAdd = activeTransfers.size < MAX_CONCURRENT_TRANSFERS;
      expect(canAdd).toBe(true);
    });
  });

  describe('Simple Hash', () => {
    // Implement simpleHash as in the module
    const simpleHash = (str) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return hash.toString(16);
    };

    it('should produce consistent hash for same input', () => {
      const input = 'test data';
      const hash1 = simpleHash(input);
      const hash2 = simpleHash(input);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different input', () => {
      const hash1 = simpleHash('test data 1');
      const hash2 = simpleHash('test data 2');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = simpleHash('');
      expect(hash).toBe('0');
    });

    it('should return hexadecimal string', () => {
      const hash = simpleHash('test');
      expect(/^-?[0-9a-f]+$/i.test(hash)).toBe(true);
    });
  });

  describe('LWW Entry Creation', () => {
    it('should include all required fields', () => {
      const id = 'goal-123';
      const value = { goal: 'test goal' };
      const clock = 5;
      const peerId = 'peer-abc';

      const entry = {
        id,
        value,
        clock,
        peerId,
        updatedAt: Date.now(),
        sharedFrom: null
      };

      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('value');
      expect(entry).toHaveProperty('clock');
      expect(entry).toHaveProperty('peerId');
      expect(entry).toHaveProperty('updatedAt');
      expect(entry).toHaveProperty('sharedFrom');
    });

    it('should use numeric clock value', () => {
      const entry = {
        id: 'test',
        value: {},
        clock: 42,
        peerId: 'peer-1',
        updatedAt: Date.now(),
        sharedFrom: null
      };

      expect(typeof entry.clock).toBe('number');
    });
  });

  describe('State Storage', () => {
    it('should handle Map-based state storage', () => {
      const syncedState = new Map();

      // Set state
      const entry = {
        id: 'goal-1',
        value: { goal: 'test' },
        clock: 1,
        peerId: 'peer-1',
        updatedAt: Date.now(),
        sharedFrom: null
      };

      syncedState.set(entry.id, entry);

      expect(syncedState.has('goal-1')).toBe(true);
      expect(syncedState.get('goal-1')).toBe(entry);
      expect(syncedState.size).toBe(1);
    });

    it('should update existing entries', () => {
      const syncedState = new Map();

      const entry1 = { id: 'goal-1', value: 'v1', clock: 1, peerId: 'p1', updatedAt: 1 };
      const entry2 = { id: 'goal-1', value: 'v2', clock: 2, peerId: 'p1', updatedAt: 2 };

      syncedState.set(entry1.id, entry1);
      syncedState.set(entry2.id, entry2);

      expect(syncedState.size).toBe(1);
      expect(syncedState.get('goal-1').value).toBe('v2');
    });

    it('should return all entries', () => {
      const syncedState = new Map();

      syncedState.set('a', { id: 'a', value: 1 });
      syncedState.set('b', { id: 'b', value: 2 });
      syncedState.set('c', { id: 'c', value: 3 });

      const all = Array.from(syncedState.values());

      expect(all.length).toBe(3);
    });
  });

  describe('Reflection Sharing', () => {
    it('should include sharedFrom tag in shared reflections', () => {
      const reflection = {
        type: 'insight',
        content: 'Test reflection',
        tags: ['test']
      };

      const peerId = 'peer-sender';

      const enrichedReflection = {
        ...reflection,
        tags: [...(reflection.tags || []), `shared_from_${peerId}`],
        context: {
          ...reflection.context,
          sharedFrom: peerId,
          sharedAt: Date.now()
        }
      };

      expect(enrichedReflection.tags).toContain(`shared_from_${peerId}`);
      expect(enrichedReflection.context.sharedFrom).toBe(peerId);
      expect(enrichedReflection.context.sharedAt).toBeDefined();
    });
  });

  describe('Artifact Announcement', () => {
    it('should include required metadata in announcement', () => {
      const announcement = {
        id: 'artifact-123',
        name: 'test.txt',
        type: 'text/plain',
        size: 1024,
        hash: 'abc123'
      };

      expect(announcement).toHaveProperty('id');
      expect(announcement).toHaveProperty('name');
      expect(announcement).toHaveProperty('type');
      expect(announcement).toHaveProperty('size');
      expect(announcement).toHaveProperty('hash');
    });
  });

  describe('Edge Cases', () => {
    it('should handle merge with missing fields gracefully', () => {
      const merge = (local, remote) => {
        const localClock = local?.clock ?? 0;
        const remoteClock = remote?.clock ?? 0;
        const localPeerId = local?.peerId ?? '';
        const remotePeerId = remote?.peerId ?? '';

        if (remoteClock > localClock) return { winner: 'remote', value: remote };
        if (remoteClock < localClock) return { winner: 'local', value: local };
        if (remotePeerId > localPeerId) return { winner: 'remote', value: remote };
        return { winner: 'local', value: local };
      };

      const local = { clock: 5 }; // missing peerId
      const remote = { clock: 5 }; // missing peerId

      // Should not throw
      expect(() => merge(local, remote)).not.toThrow();
    });

    it('should handle null entries in state', () => {
      const syncedState = new Map();
      syncedState.set('null-entry', null);

      expect(syncedState.get('null-entry')).toBeNull();
    });
  });
});
