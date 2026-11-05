import { expect, it } from 'vitest';
import { publicProviderHardware } from '../../packages/reploid/src/mesh/provider-hardware.js';

it('publishes only bounded GPU fields, never host names or arbitrary device inventory', () => {
  expect(publicProviderHardware({ vendor: ' AMD\n', architecture: 'rdna', description: 'x'.repeat(200),
    device: 123, hostname: 'private-host', memoryBytes: 123 })).toEqual({ vendor: 'AMD', architecture: 'rdna', description: 'x'.repeat(160) });
  for (const value of [null, [], 'GPU', {}, { vendor: ' ', device: 0 }]) expect(publicProviderHardware(value)).toBeNull();
});
