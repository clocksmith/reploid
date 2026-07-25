import { describe, expect, it } from 'vitest';
import {
  compactContextForManagedProvider,
  getModelIterationLimit,
  getProviderRetryAfterMs,
  parseWaitDirective,
  resolveAgentCycleIntervalMs,
  resolveProviderThrottleConfig
} from '../../self/core/agent-loop-policies.js';

describe('AgentLoop policies', () => {
  it('normalizes provider throttling from legacy and current keys', () => {
    expect(resolveProviderThrottleConfig([{
      requestIntervalMs: 250,
      backoffBaseMs: 500,
      backoffMaxMs: 4000,
      jitterRatio: 2,
      autoResume: false
    }])).toEqual({
      minProviderRequestIntervalMs: 250,
      providerBackoffBaseMs: 500,
      providerBackoffMaxMs: 4000,
      providerBackoffJitterRatio: 1,
      providerAutoResume: false
    });
  });

  it('normalizes cycle intervals and managed iteration caps', () => {
    expect(resolveAgentCycleIntervalMs([{ cycleIntervalSeconds: 2 }])).toBe(2000);
    expect(getModelIterationLimit({ managedServerProxy: true, maxIterations: 500 })).toBe(99);
    expect(getModelIterationLimit({ maxIterations: 500 })).toBe(256);
  });

  it('compacts managed-provider context while retaining anchors and recent messages', () => {
    const context = [
      { role: 'system', content: 'system anchor' },
      { role: 'user', content: 'goal anchor' },
      ...Array.from({ length: 12 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        content: `message-${index}-${'x'.repeat(600)}`
      }))
    ];
    const result = compactContextForManagedProvider(context, {
      managedServerProxy: true,
      contextEnvelope: {
        maxMessages: 8,
        targetMessages: 6,
        keepRecentMessages: 4,
        maxInputChars: 5000,
        targetInputChars: 3000,
        maxMessageChars: 1000
      }
    });

    expect(result.changed).toBe(true);
    expect(result.newMessages).toBeLessThanOrEqual(6);
    expect(result.context[0].content).toBe('system anchor');
    expect(result.context.some((message) => message.content === 'goal anchor')).toBe(true);
    expect(result.context.at(-1).content).toContain('message-11');
  });

  it('parses explicit waits and Retry-After values', () => {
    expect(parseWaitDirective('PARK: provider quota for 2 minutes')).toEqual({
      directive: 'PARK',
      reason: 'provider quota for 2 minutes',
      delayMs: 120000
    });
    expect(getProviderRetryAfterMs({ retryAfter: 3 })).toBe(3000);
    expect(getProviderRetryAfterMs({ retryAfterMs: 750 })).toBe(750);
  });
});
