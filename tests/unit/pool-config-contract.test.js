import { describe, expect, it, vi } from 'vitest';

import {
  POLICY_IDS,
  createPoolConfigContract,
  validatePoolConfigValue
} from '../../self/pool/config-contract.js';
import poolConfig from '../../self/pool/pool-config.json' with { type: 'json' };

describe('Poolday configuration contract', () => {
  it('builds immutable browser and server views from one pure contract', () => {
    const hashJson = vi.fn(() => 'sha256:config');
    const contract = createPoolConfigContract(poolConfig, { hashJson });

    expect(contract.POOL_CONFIG_VERSION).toBe(poolConfig.configVersion);
    expect(contract.POOL_CONFIG_HASH).toBe('sha256:config');
    expect(hashJson).toHaveBeenCalledWith(contract.POOL_CONFIG);
    expect(contract.getPolicy(POLICY_IDS.fastestReceipt)?.policyId).toBe('fastest_receipt');
    expect(contract.LAUNCH_POLICIES).toBe(contract.POLICIES);
    expect(Object.isFrozen(contract.POOL_CONFIG)).toBe(true);
    expect(Object.isFrozen(contract.POOL_CONFIG.launchModel)).toBe(true);
  });

  it('validates supplied config without environment-specific loaders', () => {
    expect(validatePoolConfigValue(poolConfig)).toEqual({ ok: true, reasons: [] });
    const invalid = structuredClone(poolConfig);
    delete invalid.browserRuntime.dopplerModuleUrl;
    expect(validatePoolConfigValue(invalid)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['browserRuntime.dopplerModuleUrl is required'])
    });
  });
});
