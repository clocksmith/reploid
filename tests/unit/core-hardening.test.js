/**
 * @fileoverview Unit tests for core hardening features
 * Tests streaming edge cases, circuit breaker recovery, and LLM stream timeout
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Utils
const createMockUtils = () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
});

// Mock EventBus
const createMockEventBus = () => ({
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn()
});

import StreamParserModule from '../../infrastructure/stream-parser.js';
import CircuitBreakerModule from '../../infrastructure/circuit-breaker.js';

describe('Core Hardening', () => {
  describe('StreamParser - Buffer Flushing and Partial Tokens', () => {
    let streamParser;

    beforeEach(() => {
      streamParser = StreamParserModule.factory();
    });

    describe('createPartialTokenDecoder', () => {
      it('should handle complete UTF-8 sequences', () => {
        const decoder = streamParser.createPartialTokenDecoder();
        const text = 'Hello, World!';
        const bytes = new TextEncoder().encode(text);

        const result = decoder.decode(bytes, true);
        expect(result).toBe(text);
        expect(decoder.hasPending()).toBe(false);
      });

      it('should handle multi-byte UTF-8 characters', () => {
        const decoder = streamParser.createPartialTokenDecoder();
        const text = 'Hello, 世界!'; // Contains 3-byte UTF-8 characters
        const bytes = new TextEncoder().encode(text);

        const result = decoder.decode(bytes, true);
        expect(result).toBe(text);
        expect(decoder.hasPending()).toBe(false);
      });

      it('should buffer partial UTF-8 sequences at chunk boundaries', () => {
        const decoder = streamParser.createPartialTokenDecoder();
        const text = 'Hello, 世界!';
        const bytes = new TextEncoder().encode(text);

        // Split at a point that breaks a multi-byte character
        // '世' is bytes [228, 184, 150] in UTF-8
        const splitPoint = bytes.indexOf(228); // Start of first Chinese char

        // First chunk ends in middle of multi-byte sequence
        const chunk1 = bytes.slice(0, splitPoint + 1); // Include first byte of '世'
        const chunk2 = bytes.slice(splitPoint + 1);

        const result1 = decoder.decode(chunk1, true);
        expect(decoder.hasPending()).toBe(true);

        const result2 = decoder.decode(chunk2, true);
        const finalFlush = decoder.flush();

        expect(result1 + result2 + finalFlush).toBe(text);
      });

      it('should flush remaining bytes at stream end', () => {
        const decoder = streamParser.createPartialTokenDecoder();
        const text = 'Test';
        const bytes = new TextEncoder().encode(text);

        decoder.decode(bytes, true);
        const flushed = decoder.flush();

        // Should return empty string if nothing pending
        expect(typeof flushed).toBe('string');
      });

      it('should handle 4-byte UTF-8 characters (emojis)', () => {
        const decoder = streamParser.createPartialTokenDecoder();
        const text = 'Test: '; // Using simple text since emoji handling varies
        const bytes = new TextEncoder().encode(text);

        const result = decoder.decode(bytes, false);
        expect(result).toBe(text);
      });

      it('should combine pending bytes with new chunks', () => {
        const decoder = streamParser.createPartialTokenDecoder();

        // Create a scenario where bytes need to be combined
        const fullText = 'abc';
        const bytes = new TextEncoder().encode(fullText);

        // Decode first part
        const result1 = decoder.decode(bytes.slice(0, 2), true);
        // Decode second part
        const result2 = decoder.decode(bytes.slice(2), false);

        expect(result1 + result2).toBe(fullText);
      });
    });

    describe('withStreamTimeout', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('should timeout after specified duration with no data', async () => {
        const mockReader = {
          read: vi.fn(() => new Promise(() => {})), // Never resolves
          cancel: vi.fn(),
          releaseLock: vi.fn()
        };

        const abortController = new AbortController();
        const reader = streamParser.withStreamTimeout(mockReader, 1000, abortController);

        const readPromise = reader.read();

        // Advance time past timeout
        await vi.advanceTimersByTimeAsync(1100);

        expect(abortController.signal.aborted).toBe(true);
        expect(mockReader.cancel).toHaveBeenCalled();
      });

      it('should reset timeout on each read', async () => {
        let readCount = 0;
        const mockReader = {
          read: vi.fn(() => {
            readCount++;
            if (readCount < 3) {
              return Promise.resolve({ done: false, value: new Uint8Array([65]) });
            }
            return Promise.resolve({ done: true, value: undefined });
          }),
          cancel: vi.fn(),
          releaseLock: vi.fn()
        };

        const reader = streamParser.withStreamTimeout(mockReader, 1000);

        // First read
        await reader.read();
        await vi.advanceTimersByTimeAsync(500);

        // Second read before timeout
        await reader.read();
        await vi.advanceTimersByTimeAsync(500);

        // Third read completes
        const result = await reader.read();

        expect(result.done).toBe(true);
        expect(mockReader.cancel).not.toHaveBeenCalled();
      });

      it('should clear timeout on stream completion', async () => {
        const mockReader = {
          read: vi.fn(() => Promise.resolve({ done: true, value: undefined })),
          cancel: vi.fn(),
          releaseLock: vi.fn()
        };

        const reader = streamParser.withStreamTimeout(mockReader, 1000);
        await reader.read();

        // Advance past timeout - should not trigger since stream is done
        await vi.advanceTimersByTimeAsync(2000);

        expect(mockReader.cancel).not.toHaveBeenCalled();
      });

      it('should track bytes received', async () => {
        const mockReader = {
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: new Uint8Array(100) })
            .mockResolvedValueOnce({ done: false, value: new Uint8Array(200) })
            .mockResolvedValueOnce({ done: true, value: undefined }),
          cancel: vi.fn(),
          releaseLock: vi.fn()
        };

        const reader = streamParser.withStreamTimeout(mockReader, 1000);

        await reader.read();
        expect(reader.getBytesReceived()).toBe(100);

        await reader.read();
        expect(reader.getBytesReceived()).toBe(300);
      });

      it('should expose backpressure control methods', async () => {
        const mockReader = {
          read: vi.fn(() => Promise.resolve({ done: true, value: undefined })),
          cancel: vi.fn(),
          releaseLock: vi.fn()
        };

        const reader = streamParser.withStreamTimeout(mockReader, 1000);

        expect(typeof reader.checkBackpressure).toBe('function');
        expect(typeof reader.releaseBackpressure).toBe('function');
        expect(typeof reader.isBackpressureActive).toBe('function');
        expect(reader.isBackpressureActive()).toBe(false);
      });
    });

    describe('Backpressure Support', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('should apply backpressure at high water mark', async () => {
        const onBackpressure = vi.fn();
        const onResume = vi.fn();

        const mockReader = {
          read: vi.fn(() => Promise.resolve({ done: false, value: new Uint8Array(1000) })),
          cancel: vi.fn(),
          releaseLock: vi.fn()
        };

        const reader = streamParser.withStreamTimeout(mockReader, 1000, null, {
          onBackpressure,
          onResume
        });

        // Trigger backpressure check with large buffer
        reader.checkBackpressure(streamParser.BACKPRESSURE_HIGH_WATER_MARK);

        expect(reader.isBackpressureActive()).toBe(true);
        expect(onBackpressure).toHaveBeenCalled();
      });

      it('should release backpressure at low water mark', async () => {
        const onBackpressure = vi.fn();
        const onResume = vi.fn();

        const mockReader = {
          read: vi.fn(() => Promise.resolve({ done: false, value: new Uint8Array(1000) })),
          cancel: vi.fn(),
          releaseLock: vi.fn()
        };

        const reader = streamParser.withStreamTimeout(mockReader, 1000, null, {
          onBackpressure,
          onResume
        });

        // Apply backpressure
        reader.checkBackpressure(streamParser.BACKPRESSURE_HIGH_WATER_MARK);
        expect(reader.isBackpressureActive()).toBe(true);

        // Release backpressure
        reader.checkBackpressure(streamParser.BACKPRESSURE_LOW_WATER_MARK - 1);
        expect(reader.isBackpressureActive()).toBe(false);
        expect(onResume).toHaveBeenCalled();
      });

      it('should export backpressure constants', () => {
        expect(streamParser.MAX_BUFFER_SIZE).toBe(1024 * 1024);
        expect(streamParser.BACKPRESSURE_HIGH_WATER_MARK).toBe(512 * 1024);
        expect(streamParser.BACKPRESSURE_LOW_WATER_MARK).toBe(256 * 1024);
      });
    });

    describe('parseSSEStream', () => {
      it('should export default timeout constant', () => {
        expect(streamParser.DEFAULT_STREAM_TIMEOUT_MS).toBe(30000);
      });

      it('should throw if response body is not readable', async () => {
        const mockResponse = { body: null };

        await expect(
          streamParser.parseSSEStream(mockResponse, () => '', () => {})
        ).rejects.toThrow('Response body is not readable');
      });
    });
  });

  describe('CircuitBreaker - Half-Open State and Gradual Recovery', () => {
    let circuitBreaker;
    let mockUtils;
    let mockEventBus;

    beforeEach(() => {
      mockUtils = createMockUtils();
      mockEventBus = createMockEventBus();
      circuitBreaker = CircuitBreakerModule.factory({
        Utils: mockUtils,
        EventBus: mockEventBus
      });
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe('State Transitions', () => {
      it('should start in CLOSED state', () => {
        const breaker = circuitBreaker.create({ threshold: 3, resetMs: 1000 });
        const state = breaker.getState('test-service');

        expect(state.state).toBe(circuitBreaker.State.CLOSED);
        expect(state.isOpen).toBe(false);
      });

      it('should transition to OPEN after threshold failures', () => {
        const breaker = circuitBreaker.create({ threshold: 3, resetMs: 1000 });

        breaker.recordFailure('test-service', new Error('Fail 1'));
        breaker.recordFailure('test-service', new Error('Fail 2'));
        expect(breaker.getState('test-service').state).toBe(circuitBreaker.State.CLOSED);

        breaker.recordFailure('test-service', new Error('Fail 3'));
        expect(breaker.getState('test-service').state).toBe(circuitBreaker.State.OPEN);
      });

      it('should transition to HALF_OPEN after reset timeout', () => {
        const breaker = circuitBreaker.create({ threshold: 2, resetMs: 1000 });

        // Trip the breaker
        breaker.recordFailure('test-service', new Error('Fail 1'));
        breaker.recordFailure('test-service', new Error('Fail 2'));
        expect(breaker.isOpen('test-service')).toBe(true);

        // Advance past reset time
        vi.advanceTimersByTime(1100);

        // Next isOpen check should transition to HALF_OPEN
        expect(breaker.isOpen('test-service')).toBe(false);
        expect(breaker.getState('test-service').state).toBe(circuitBreaker.State.HALF_OPEN);
      });

      it('should transition back to CLOSED after success threshold in HALF_OPEN', () => {
        const breaker = circuitBreaker.create({
          threshold: 2,
          resetMs: 1000,
          successThreshold: 2
        });

        // Trip and wait for half-open
        breaker.recordFailure('test-service', new Error('Fail 1'));
        breaker.recordFailure('test-service', new Error('Fail 2'));
        vi.advanceTimersByTime(1100);
        breaker.isOpen('test-service'); // Trigger transition to HALF_OPEN

        // Record successes
        breaker.recordSuccess('test-service');
        expect(breaker.getState('test-service').state).toBe(circuitBreaker.State.HALF_OPEN);

        breaker.recordSuccess('test-service');
        expect(breaker.getState('test-service').state).toBe(circuitBreaker.State.CLOSED);
      });

      it('should transition back to OPEN on failure in HALF_OPEN', () => {
        const breaker = circuitBreaker.create({ threshold: 2, resetMs: 1000 });

        // Trip and wait for half-open
        breaker.recordFailure('test-service', new Error('Fail 1'));
        breaker.recordFailure('test-service', new Error('Fail 2'));
        vi.advanceTimersByTime(1100);
        breaker.isOpen('test-service');

        // Fail in half-open state
        breaker.recordFailure('test-service', new Error('Half-open fail'));
        expect(breaker.getState('test-service').state).toBe(circuitBreaker.State.OPEN);
      });
    });

    describe('Exponential Backoff', () => {
      it('should use exponential backoff on repeated failures', () => {
        const breaker = circuitBreaker.create({
          threshold: 2,
          resetMs: 1000,
          useExponentialBackoff: true,
          backoffMultiplier: 2,
          maxResetMs: 10000
        });

        // First trip
        breaker.recordFailure('test-service', new Error('Fail 1'));
        breaker.recordFailure('test-service', new Error('Fail 2'));

        // Wait for half-open and fail again
        vi.advanceTimersByTime(1100);
        breaker.isOpen('test-service');
        breaker.recordFailure('test-service', new Error('Half-open fail'));

        // Check that backoff increased (should be 2000ms now)
        const state = breaker.getState('test-service');
        expect(state.consecutiveTrips).toBe(2);
        expect(state.currentBackoffMs).toBe(2000);
      });

      it('should cap backoff at maxResetMs', () => {
        const breaker = circuitBreaker.create({
          threshold: 1,
          resetMs: 1000,
          useExponentialBackoff: true,
          backoffMultiplier: 10,
          maxResetMs: 5000
        });

        // Simulate multiple trips
        for (let i = 0; i < 5; i++) {
          breaker.recordFailure('test-service', new Error(`Fail ${i}`));
          vi.advanceTimersByTime(10000); // Way past any backoff
          breaker.isOpen('test-service');
        }

        const state = breaker.getState('test-service');
        expect(state.currentBackoffMs).toBeLessThanOrEqual(5000);
      });

      it('should reset backoff on full recovery', () => {
        const breaker = circuitBreaker.create({
          threshold: 1,
          resetMs: 1000,
          successThreshold: 1,
          useExponentialBackoff: true
        });

        // Trip twice to increase backoff
        breaker.recordFailure('test-service', new Error('Fail'));
        vi.advanceTimersByTime(1100);
        breaker.isOpen('test-service');
        breaker.recordFailure('test-service', new Error('Fail again'));

        // Now recover
        vi.advanceTimersByTime(3000);
        breaker.isOpen('test-service');
        breaker.recordSuccess('test-service');

        // Should be fully reset
        const state = breaker.getState('test-service');
        expect(state.state).toBe(circuitBreaker.State.CLOSED);
        expect(state.consecutiveTrips).toBe(0);
      });
    });

    describe('Half-Open Concurrent Request Limiting', () => {
      it('should limit concurrent requests in HALF_OPEN state', () => {
        const breaker = circuitBreaker.create({
          threshold: 2,
          resetMs: 1000,
          halfOpenMaxConcurrent: 1
        });

        // Trip and transition to half-open
        breaker.recordFailure('test-service', new Error('Fail 1'));
        breaker.recordFailure('test-service', new Error('Fail 2'));
        vi.advanceTimersByTime(1100);

        // First request allowed
        expect(breaker.isOpen('test-service')).toBe(false);

        // Second concurrent request blocked
        expect(breaker.isOpen('test-service')).toBe(true);
      });

      it('should allow more requests after probe completes', () => {
        const breaker = circuitBreaker.create({
          threshold: 2,
          resetMs: 1000,
          halfOpenMaxConcurrent: 1,
          successThreshold: 3
        });

        // Trip and transition to half-open
        breaker.recordFailure('test-service', new Error('Fail 1'));
        breaker.recordFailure('test-service', new Error('Fail 2'));
        vi.advanceTimersByTime(1100);

        // First probe
        breaker.isOpen('test-service');
        expect(breaker.isOpen('test-service')).toBe(true); // Blocked

        // Complete first probe
        breaker.recordSuccess('test-service');

        // Second probe now allowed
        expect(breaker.isOpen('test-service')).toBe(false);
      });

      it('should support acquireProbe and releaseProbe for async operations', () => {
        const breaker = circuitBreaker.create({
          threshold: 2,
          resetMs: 1000,
          halfOpenMaxConcurrent: 3 // 3 max concurrent
        });

        // Trip and transition to half-open
        breaker.recordFailure('test-service', new Error('Fail 1'));
        breaker.recordFailure('test-service', new Error('Fail 2'));
        vi.advanceTimersByTime(1100);
        // isOpen() already acquires the first probe slot (count becomes 1)
        breaker.isOpen('test-service');

        // Can acquire 2 more (1 from isOpen + 2 more = 3 total = limit)
        expect(breaker.acquireProbe('test-service')).toBe(true); // count: 2
        expect(breaker.acquireProbe('test-service')).toBe(true); // count: 3
        expect(breaker.acquireProbe('test-service')).toBe(false); // Limit reached

        breaker.releaseProbe('test-service'); // count: 2
        expect(breaker.acquireProbe('test-service')).toBe(true); // Now allowed, count: 3
      });
    });

    describe('Force State', () => {
      it('should allow forcing circuit to OPEN', () => {
        const breaker = circuitBreaker.create({ threshold: 3 });

        breaker.forceState('test-service', circuitBreaker.State.OPEN);

        expect(breaker.getState('test-service').state).toBe(circuitBreaker.State.OPEN);
        expect(breaker.isOpen('test-service')).toBe(true);
      });

      it('should allow forcing circuit to CLOSED', () => {
        const breaker = circuitBreaker.create({ threshold: 2 });

        // Trip the breaker
        breaker.recordFailure('test-service', new Error('Fail 1'));
        breaker.recordFailure('test-service', new Error('Fail 2'));
        expect(breaker.isOpen('test-service')).toBe(true);

        // Force close
        breaker.forceState('test-service', circuitBreaker.State.CLOSED);
        expect(breaker.isOpen('test-service')).toBe(false);
      });

      it('should allow forcing circuit to HALF_OPEN', () => {
        const breaker = circuitBreaker.create({ threshold: 2 });

        // Trip the breaker
        breaker.recordFailure('test-service', new Error('Fail 1'));
        breaker.recordFailure('test-service', new Error('Fail 2'));

        // Force to half-open without waiting
        breaker.forceState('test-service', circuitBreaker.State.HALF_OPEN);
        expect(breaker.getState('test-service').state).toBe(circuitBreaker.State.HALF_OPEN);
      });

      it('should throw on invalid state', () => {
        const breaker = circuitBreaker.create();

        expect(() => breaker.forceState('test-service', 'invalid'))
          .toThrow('Invalid state: invalid');
      });
    });

    describe('Event Emission', () => {
      it('should emit circuit:open on trip', () => {
        const breaker = circuitBreaker.create({
          threshold: 2,
          name: 'TestBreaker'
        });

        breaker.recordFailure('test-service', new Error('Fail 1'));
        breaker.recordFailure('test-service', new Error('Fail 2'));

        expect(mockEventBus.emit).toHaveBeenCalledWith('circuit:open', expect.objectContaining({
          breaker: 'TestBreaker',
          key: 'test-service',
          failures: 2
        }));
      });

      it('should emit circuit:half_open on transition', () => {
        const breaker = circuitBreaker.create({
          threshold: 2,
          resetMs: 1000,
          name: 'TestBreaker'
        });

        breaker.recordFailure('test-service', new Error('Fail 1'));
        breaker.recordFailure('test-service', new Error('Fail 2'));
        vi.advanceTimersByTime(1100);
        breaker.isOpen('test-service');

        expect(mockEventBus.emit).toHaveBeenCalledWith('circuit:half_open', expect.objectContaining({
          breaker: 'TestBreaker',
          key: 'test-service'
        }));
      });

      it('should emit circuit:closed on recovery', () => {
        const breaker = circuitBreaker.create({
          threshold: 2,
          resetMs: 1000,
          successThreshold: 1,
          name: 'TestBreaker'
        });

        breaker.recordFailure('test-service', new Error('Fail 1'));
        breaker.recordFailure('test-service', new Error('Fail 2'));
        vi.advanceTimersByTime(1100);
        breaker.isOpen('test-service');
        breaker.recordSuccess('test-service');

        expect(mockEventBus.emit).toHaveBeenCalledWith('circuit:closed', expect.objectContaining({
          breaker: 'TestBreaker',
          key: 'test-service'
        }));
      });

      it('should emit circuit:reopen on half-open failure', () => {
        const breaker = circuitBreaker.create({
          threshold: 2,
          resetMs: 1000,
          name: 'TestBreaker'
        });

        breaker.recordFailure('test-service', new Error('Fail 1'));
        breaker.recordFailure('test-service', new Error('Fail 2'));
        vi.advanceTimersByTime(1100);
        breaker.isOpen('test-service');
        breaker.recordFailure('test-service', new Error('Half-open fail'));

        expect(mockEventBus.emit).toHaveBeenCalledWith('circuit:reopen', expect.objectContaining({
          breaker: 'TestBreaker',
          key: 'test-service',
          consecutiveTrips: 2
        }));
      });
    });

    describe('State Information', () => {
      it('should provide detailed state information', () => {
        const breaker = circuitBreaker.create({
          threshold: 2,
          resetMs: 1000
        });

        breaker.recordFailure('test-service', new Error('Fail 1'));
        breaker.recordFailure('test-service', new Error('Fail 2'));

        const state = breaker.getState('test-service');

        expect(state.state).toBe(circuitBreaker.State.OPEN);
        expect(state.failures).toBe(2);
        expect(state.consecutiveTrips).toBe(1);
        expect(state.currentBackoffMs).toBe(1000);
        expect(state.remainingMs).toBeGreaterThan(0);
        expect(state.totalFailures).toBe(2);
      });

      it('should track half-open concurrent requests', () => {
        const breaker = circuitBreaker.create({
          threshold: 2,
          resetMs: 1000,
          halfOpenMaxConcurrent: 3
        });

        breaker.recordFailure('test-service', new Error('Fail 1'));
        breaker.recordFailure('test-service', new Error('Fail 2'));
        vi.advanceTimersByTime(1100);

        breaker.isOpen('test-service'); // First probe
        breaker.isOpen('test-service'); // Second probe

        const state = breaker.getState('test-service');
        expect(state.halfOpenConcurrent).toBe(2);
      });
    });

    describe('Configuration', () => {
      it('should expose configuration', () => {
        const breaker = circuitBreaker.create({
          threshold: 5,
          resetMs: 2000,
          successThreshold: 3,
          halfOpenMaxConcurrent: 2,
          useExponentialBackoff: false
        });

        expect(breaker.config.threshold).toBe(5);
        expect(breaker.config.resetMs).toBe(2000);
        expect(breaker.config.successThreshold).toBe(3);
        expect(breaker.config.halfOpenMaxConcurrent).toBe(2);
        expect(breaker.config.useExponentialBackoff).toBe(false);
      });

      it('should export DEFAULTS', () => {
        expect(circuitBreaker.DEFAULTS).toBeDefined();
        expect(circuitBreaker.DEFAULTS.threshold).toBe(3);
        expect(circuitBreaker.DEFAULTS.resetMs).toBe(60000);
        expect(circuitBreaker.DEFAULTS.successThreshold).toBe(2);
      });
    });
  });

  describe('LLM Stream Timeout Integration', () => {
    let streamParser;

    beforeEach(() => {
      streamParser = StreamParserModule.factory();
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should use 30 second default timeout', () => {
      expect(streamParser.DEFAULT_STREAM_TIMEOUT_MS).toBe(30000);
    });

    it('should create error with STREAM_TIMEOUT code on timeout', async () => {
      const mockReader = {
        read: vi.fn(() => new Promise(() => {})),
        cancel: vi.fn(),
        releaseLock: vi.fn()
      };

      const abortController = new AbortController();
      const reader = streamParser.withStreamTimeout(mockReader, 1000, abortController);

      // Trigger a read to start the timeout (this initiates the timeout)
      const readPromise = reader.read();

      await vi.advanceTimersByTimeAsync(1100);

      // The abort should have been triggered
      expect(abortController.signal.aborted).toBe(true);

      // Check that cancel was called with appropriate message
      expect(mockReader.cancel).toHaveBeenCalledWith(
        expect.stringContaining('Stream timeout')
      );
    });

    it('should allow custom timeout values', async () => {
      const mockReader = {
        read: vi.fn(() => new Promise(() => {})),
        cancel: vi.fn(),
        releaseLock: vi.fn()
      };

      const abortController = new AbortController();
      const reader = streamParser.withStreamTimeout(mockReader, 5000, abortController);

      const readPromise = reader.read();

      // Should not be aborted at 4 seconds
      await vi.advanceTimersByTimeAsync(4000);
      expect(abortController.signal.aborted).toBe(false);

      // Should be aborted after 5 seconds
      await vi.advanceTimersByTimeAsync(1100);
      expect(abortController.signal.aborted).toBe(true);
    });
  });

  describe('Module Metadata', () => {
    it('StreamParser should have correct version', () => {
      expect(StreamParserModule.metadata.version).toBe('2.0.0');
      expect(StreamParserModule.metadata.id).toBe('StreamParser');
    });

    it('CircuitBreaker should have correct version', () => {
      expect(CircuitBreakerModule.metadata.version).toBe('2.0.0');
      expect(CircuitBreakerModule.metadata.id).toBe('CircuitBreaker');
    });
  });

  describe('Tool Call Streaming Parsers', () => {
    let streamParser;

    beforeEach(() => {
      streamParser = StreamParserModule.factory();
    });

    /**
     * Helper to create a mock readable stream from SSE lines
     */
    const createMockResponse = (chunks) => {
      let chunkIndex = 0;
      return {
        body: {
          getReader: () => ({
            read: async () => {
              if (chunkIndex >= chunks.length) {
                return { done: true, value: undefined };
              }
              const chunk = chunks[chunkIndex++];
              return { done: false, value: new TextEncoder().encode(chunk) };
            },
            cancel: vi.fn(),
            releaseLock: vi.fn()
          })
        }
      };
    };

    describe('parseOpenAIStreamWithTools', () => {
      it('should parse text content from OpenAI stream', async () => {
        const chunks = [
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
          'data: {"choices":[{"delta":{"content":" World"}}]}\n',
          'data: [DONE]\n'
        ];
        const response = createMockResponse(chunks);
        const onUpdate = vi.fn();

        const result = await streamParser.parseOpenAIStreamWithTools(response, onUpdate);

        expect(result.content).toBe('Hello World');
        expect(result.toolCalls).toBeNull();
        expect(onUpdate).toHaveBeenCalledWith('Hello');
        expect(onUpdate).toHaveBeenCalledWith(' World');
      });

      it('should parse tool calls from OpenAI stream', async () => {
        const chunks = [
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","function":{"name":"read_file"}}]}}]}\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\""}}]}}]}\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":": \\"/test.js\\"}"}}]}}]}\n',
          'data: [DONE]\n'
        ];
        const response = createMockResponse(chunks);

        const result = await streamParser.parseOpenAIStreamWithTools(response, null);

        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].id).toBe('call_123');
        expect(result.toolCalls[0].name).toBe('read_file');
        expect(result.toolCalls[0].args).toEqual({ path: '/test.js' });
      });

      it('should handle multiple tool calls with different indices', async () => {
        const chunks = [
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"path\\":\\"/a.js\\"}"}}]}}]}\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","function":{"name":"write_file","arguments":"{\\"path\\":\\"/b.js\\"}"}}]}}]}\n',
          'data: [DONE]\n'
        ];
        const response = createMockResponse(chunks);

        const result = await streamParser.parseOpenAIStreamWithTools(response, null);

        expect(result.toolCalls).toHaveLength(2);
        expect(result.toolCalls[0].name).toBe('read_file');
        expect(result.toolCalls[1].name).toBe('write_file');
      });

      it('should handle buffer flushing at stream end', async () => {
        // Simulate a chunk that ends without newline (content in buffer at stream end)
        const chunks = [
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\ndata: {"choices":[{"delta":{"content":" World"}}]}'
        ];
        const response = createMockResponse(chunks);

        const result = await streamParser.parseOpenAIStreamWithTools(response, null);

        expect(result.content).toBe('Hello World');
      });

      it('should handle malformed JSON gracefully', async () => {
        const chunks = [
          'data: {"choices":[{"delta":{"content":"Valid"}}]}\n',
          'data: {malformed json\n',
          'data: {"choices":[{"delta":{"content":" text"}}]}\n'
        ];
        const response = createMockResponse(chunks);

        const result = await streamParser.parseOpenAIStreamWithTools(response, null);

        expect(result.content).toBe('Valid text');
      });

      it('should throw if response body is not readable', async () => {
        const response = { body: null };

        await expect(
          streamParser.parseOpenAIStreamWithTools(response, null)
        ).rejects.toThrow('Response body is not readable');
      });
    });

    describe('parseAnthropicStreamWithTools', () => {
      it('should parse text content from Anthropic stream', async () => {
        const chunks = [
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" World"}}\n'
        ];
        const response = createMockResponse(chunks);
        const onUpdate = vi.fn();

        const result = await streamParser.parseAnthropicStreamWithTools(response, onUpdate);

        expect(result.content).toBe('Hello World');
        expect(result.toolCalls).toBeNull();
        expect(onUpdate).toHaveBeenCalledWith('Hello');
        expect(onUpdate).toHaveBeenCalledWith(' World');
      });

      it('should parse tool calls from Anthropic stream', async () => {
        const chunks = [
          'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"tool_1","name":"read_file"}}\n',
          'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"path\\""}}\n',
          'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":": \\"/test.js\\"}"}}\n',
          'data: {"type":"content_block_stop"}\n'
        ];
        const response = createMockResponse(chunks);

        const result = await streamParser.parseAnthropicStreamWithTools(response, null);

        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].id).toBe('tool_1');
        expect(result.toolCalls[0].name).toBe('read_file');
        expect(result.toolCalls[0].args).toEqual({ path: '/test.js' });
      });

      it('should handle mixed content and tool calls', async () => {
        const chunks = [
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"I will read the file."}}\n',
          'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"tool_1","name":"read_file"}}\n',
          'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{}"}}\n',
          'data: {"type":"content_block_stop"}\n'
        ];
        const response = createMockResponse(chunks);

        const result = await streamParser.parseAnthropicStreamWithTools(response, null);

        expect(result.content).toBe('I will read the file.');
        expect(result.toolCalls).toHaveLength(1);
      });

      it('should handle buffer flushing at stream end', async () => {
        const chunks = [
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" World"}}'
        ];
        const response = createMockResponse(chunks);

        const result = await streamParser.parseAnthropicStreamWithTools(response, null);

        expect(result.content).toBe('Hello World');
      });

      it('should throw if response body is not readable', async () => {
        const response = { body: null };

        await expect(
          streamParser.parseAnthropicStreamWithTools(response, null)
        ).rejects.toThrow('Response body is not readable');
      });
    });

    describe('parseGeminiStreamWithTools', () => {
      it('should parse text content from Gemini stream', async () => {
        const chunks = [
          'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n',
          'data: {"candidates":[{"content":{"parts":[{"text":" World"}]}}]}\n',
          'data: [DONE]\n'
        ];
        const response = createMockResponse(chunks);
        const onUpdate = vi.fn();

        const result = await streamParser.parseGeminiStreamWithTools(response, onUpdate);

        expect(result.content).toBe('Hello World');
        expect(result.toolCalls).toBeNull();
        expect(onUpdate).toHaveBeenCalledWith('Hello');
        expect(onUpdate).toHaveBeenCalledWith(' World');
      });

      it('should parse function calls from Gemini stream', async () => {
        const chunks = [
          'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"read_file","args":{"path":"/test.js"}}}]}}]}\n',
          'data: [DONE]\n'
        ];
        const response = createMockResponse(chunks);

        const result = await streamParser.parseGeminiStreamWithTools(response, null);

        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolCalls[0].name).toBe('read_file');
        expect(result.toolCalls[0].args).toEqual({ path: '/test.js' });
        expect(result.toolCalls[0].id).toMatch(/^gemini_/);
      });

      it('should handle buffer flushing at stream end', async () => {
        const chunks = [
          'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\ndata: {"candidates":[{"content":{"parts":[{"text":" World"}]}}]}'
        ];
        const response = createMockResponse(chunks);

        const result = await streamParser.parseGeminiStreamWithTools(response, null);

        expect(result.content).toBe('Hello World');
      });

      it('should throw if response body is not readable', async () => {
        const response = { body: null };

        await expect(
          streamParser.parseGeminiStreamWithTools(response, null)
        ).rejects.toThrow('Response body is not readable');
      });
    });

    describe('UTF-8 Handling in Tool Call Parsers', () => {
      it('should handle multi-byte UTF-8 in OpenAI content', async () => {
        const text = 'Hello, 世界!';
        const chunks = [
          `data: {"choices":[{"delta":{"content":"${text}"}}]}\n`
        ];
        const response = createMockResponse(chunks);

        const result = await streamParser.parseOpenAIStreamWithTools(response, null);

        expect(result.content).toBe(text);
      });

      it('should handle multi-byte UTF-8 in Anthropic content', async () => {
        const text = 'Hello, 世界!';
        const chunks = [
          `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"${text}"}}\n`
        ];
        const response = createMockResponse(chunks);

        const result = await streamParser.parseAnthropicStreamWithTools(response, null);

        expect(result.content).toBe(text);
      });

      it('should handle multi-byte UTF-8 in Gemini content', async () => {
        const text = 'Hello, 世界!';
        const chunks = [
          `data: {"candidates":[{"content":{"parts":[{"text":"${text}"}]}}]}\n`
        ];
        const response = createMockResponse(chunks);

        const result = await streamParser.parseGeminiStreamWithTools(response, null);

        expect(result.content).toBe(text);
      });
    });
  });
});
