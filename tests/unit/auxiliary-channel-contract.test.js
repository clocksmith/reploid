import { it, expect } from 'vitest';
import { SWARM_AUXILIARY_CHANNELS } from '../../packages/reploid/src/transport/swarm.js';
import { ORDERED_PARTITION_CHANNEL } from '../../packages/reploid/src/mesh/partitions/partition-route-network.js';
import { SWARM_AUXILIARY_CHANNELS as VENDORED_CHANNELS } from '../../self/vendor/reploid/transport/swarm.js';

// Fake transports in other tests accept any label, which hid an ordered-route channel the
// real swarm rejected. Every label a partition network opens must be admitted by the transport.
it('admits every auxiliary channel label that partition networks open', () => {
  for (const label of ['reploid-custody', 'reploid-partitions', 'reploid-partitions-input',
    'reploid-partitions-control', 'reploid-jobs', ORDERED_PARTITION_CHANNEL]) {
    expect(SWARM_AUXILIARY_CHANNELS, label).toContain(label);
  }
  expect(Object.isFrozen(SWARM_AUXILIARY_CHANNELS)).toBe(true);
  expect(SWARM_AUXILIARY_CHANNELS).not.toContain('arbitrary-work');
});
it('ships the same admitted labels in the browser vendored copy', () => {
  expect([...VENDORED_CHANNELS]).toEqual([...SWARM_AUXILIARY_CHANNELS]);
});
