// @vitest-environment node
import { describe, it, expect } from 'vitest';
import config from '../../self/pool/pool-config.json' with { type: 'json' };
import { resolvePackJobPolicy } from '../../self/pool/peer-pack-job-policy.js';
import { validatePoolConfigValue } from '../../self/pool/config-contract.js';

describe('explicit remote attempt policy', () => {
  it('requires storage, retry and numbering policy during configuration validation', () => {
    for (const path of [['persistence', 'retentionMs'], ['persistence', 'storageTimeoutMs'], ['retry', 'delayMs'],
      ['attempts', 'initialNumber'], ['execution', 'adapterSet']]) {
      const candidate = structuredClone(config);
      delete candidate.peerJobs[path[0]][path[1]];
      expect(() => resolvePackJobPolicy(candidate.peerJobs)).toThrow('Peer Pack policy');
      expect(validatePoolConfigValue(candidate).ok).toBe(false);
    }
  });

  it('rejects contradictory bounds and states that would restart interrupted work', () => {
    for (const edit of [p => { p.persistence.maxRecords = p.persistence.recordCeiling + 1; },
      p => { p.retry.delayMs = p.retry.maximumDelayMs + 1; },
      p => { p.persistence.legacyStates.running = 'accepted'; },
      p => { p.persistence.storageFailureBehavior = 'execute'; },
      p => { p.persistence.outcomeStates.failed = 'completed'; }]) {
      const candidate = structuredClone(config.peerJobs); edit(candidate);
      expect(() => resolvePackJobPolicy(candidate)).toThrow('Peer Pack policy');
    }
  });

  it('freezes an independent policy snapshot', () => {
    const candidate = structuredClone(config.peerJobs), policy = resolvePackJobPolicy(candidate);
    candidate.persistence.retentionMs += 1;
    expect(policy.persistence.retentionMs).toBe(config.peerJobs.persistence.retentionMs);
    expect(Object.isFrozen(policy.persistence.states)).toBe(true);
    expect(Object.isFrozen(policy.retry)).toBe(true);
  });
});
