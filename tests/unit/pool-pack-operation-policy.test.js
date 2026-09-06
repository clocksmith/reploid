import { describe, expect, it } from 'vitest';
import config from '../../self/pool/pool-config.json' with { type: 'json' };
import { createPackOperationRegistry } from '../../self/pool/pack-operation-adapters.js';
import { validatePoolConfigValue } from '../../self/pool/config-contract.js';
import { operationFixture } from '../fixtures/peer-pack-operation.js';
import { runPackOperation } from '../../self/pool/pack-operation.js';

describe('configured operation policy', () => {
  it('rejects missing definitions, unknown implementations, fields, comparisons and contract versions', () => {
    for (const mutate of [
      definitions => { delete definitions.embed.inputClasses; },
      definitions => { definitions.embed.adapterId = 'invented'; },
      definitions => { definitions.embed.inputContract.version++; },
      definitions => { definitions.embed.comparisonPolicyIds = ['invented']; },
      definitions => { definitions.embed.optionsContract.fieldTypes = { surprise: 'anything' }; }
    ]) {
      const definitions = structuredClone(config.operations); mutate(definitions);
      expect(() => createPackOperationRegistry({ definitions })).toThrow();
    }
    expect(() => createPackOperationRegistry({ definitions: null })).toThrow();
    expect(validatePoolConfigValue({ ...config, operations: null }).ok).toBe(false);
  });

  it('freezes policy before use and rejects fields absent from the configured contract', async () => {
    const definitions = structuredClone(config.operations);
    const registry = createPackOperationRegistry({ definitions });
    definitions.embed.inputContract.allowedFields.push('secret');
    expect(Object.isFrozen(registry.embed.definition.inputContract.allowedFields)).toBe(true);
    expect(() => registry.embed.validateRequest({ input: { texts: ['a'], application: {}, secret: 'b' }, options: {} })).toThrow('unexpected');
    const f = await operationFixture('embed', registry);
    const request = { schema: 'doppler.pack-operation-request/v1', operation: { name: 'embed', version: 1 },
      input: f.input, options: f.options, assignment: null, limits: { maxInputBytes: 1024, maxOutputBytes: 1024, deadlineAt: Date.now() + 30000 } };
    definitions.embed.streaming.partial = false;
    await expect(runPackOperation({ binding: f.binding, session: f.session, request, runtimeVersion: f.model.runtimeVersion,
      registry: createPackOperationRegistry({ definitions }) })).rejects.toThrow('forbids partial');
  });

  it('requires configured numerical parameters and operation resource ceilings', async () => {
    const registry = createPackOperationRegistry(), f = await operationFixture('embed', registry);
    expect(() => registry.embed.compare(f.output, f.output, { rule: 'numerical-tolerance', absoluteTolerance: 0 })).toThrow('relativeTolerance');
    expect(() => registry.embed.compare(f.output, f.output, { rule: 'exact-text' })).toThrow('configured');
    const definitions = structuredClone(config.operations); definitions.embed.maximumLimits.maxOutputBytes = 1;
    const request = { schema: 'doppler.pack-operation-request/v1', operation: { name: 'embed', version: 1 }, input: f.input,
      options: f.options, assignment: null, limits: { maxInputBytes: 1024, maxOutputBytes: 1024, deadlineAt: Date.now() + 30000 } };
    await expect(runPackOperation({ binding: f.binding, session: f.session, request, runtimeVersion: f.model.runtimeVersion,
      registry: createPackOperationRegistry({ definitions }) })).rejects.toThrow('configured operation limit');
    expect(f.calls()).toBe(0);
  });
});
