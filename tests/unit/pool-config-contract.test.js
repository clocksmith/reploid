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

  it('fails closed when a candidate is enabled before browser and scientific qualification', () => {
    const invalid = structuredClone(poolConfig);
    const amplify = invalid.modelCatalog.find((model) => model.modelId === 'amplify-120m-f16-af32');
    amplify.enabled = true;

    expect(validatePoolConfigValue(invalid)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        expect.stringContaining('admission.browserWebGpu must be qualified before enabling the model'),
        expect.stringContaining('admission.scientificFitness must be qualified before enabling the model')
      ])
    });
  });

  it('fails closed when a candidate license has not been admitted for product use', () => {
    const invalid = structuredClone(poolConfig);
    const nucleotide = invalid.modelCatalog.find((model) => (
      model.modelId === 'nucleotide-transformer-v2-50m-f32-af32'
    ));
    nucleotide.enabled = true;
    nucleotide.admission.browserWebGpu = 'qualified';
    nucleotide.admission.scientificFitness = 'qualified';

    expect(validatePoolConfigValue(invalid)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        expect.stringContaining('license.admission must be approved before enabling the model')
      ])
    });
  });

  it('requires a persisted browser-qualification receipt before a qualified browser lane can be enabled', () => {
    const invalid = structuredClone(poolConfig);
    const amplify = invalid.modelCatalog.find((model) => model.modelId === 'amplify-120m-f16-af32');
    amplify.enabled = true;
    amplify.admission.browserWebGpu = 'qualified';
    amplify.admission.scientificFitness = 'qualified';

    expect(validatePoolConfigValue(invalid)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        expect.stringContaining('.admission.browserQualificationReceipt is required')
      ])
    });
  });

  it('requires a persisted scientific-fitness receipt before a qualified candidate can be enabled', () => {
    const invalid = structuredClone(poolConfig);
    const amplify = invalid.modelCatalog.find((model) => model.modelId === 'amplify-120m-f16-af32');
    amplify.enabled = true;
    amplify.admission.browserWebGpu = 'qualified';
    amplify.admission.browserQualificationReceipt = 'docs/status/amplify-browser-qualification.json';
    amplify.admission.scientificFitness = 'qualified';

    expect(validatePoolConfigValue(invalid)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        expect.stringContaining('.admission.scientificFitnessReceipt is required')
      ])
    });
  });

  it('does not let a candidate reuse the ESM-2 baseline-release states', () => {
    const invalid = structuredClone(poolConfig);
    const amplify = invalid.modelCatalog.find((model) => model.modelId === 'amplify-120m-f16-af32');
    amplify.enabled = true;
    amplify.admission.browserWebGpu = 'enabled_release_receipt_required';
    amplify.admission.scientificFitness = 'baseline_release_receipt_required';

    expect(validatePoolConfigValue(invalid)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        expect.stringContaining('.admission.browserWebGpu baseline-release state is reserved for the launch model'),
        expect.stringContaining('.admission.scientificFitness baseline-release state is reserved for the launch model')
      ])
    });
  });
});
