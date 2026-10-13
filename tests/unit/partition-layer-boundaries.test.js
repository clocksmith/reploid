import path from 'node:path';
import { expect, it } from 'vitest';
import { findLayerViolations } from '../../scripts/verify-layers.js';

const repoRoot = path.resolve('/workspace/reploid');
const violations = (owner, dependency) => findLayerViolations({ repoRoot,
  sourcePath: path.join(repoRoot, 'packages/reploid/src/mesh/partitions', owner),
  source: `import '${dependency}';` });

it.each(['partition-discovery.js', 'partition-placement.js', 'partition-reservations.js'])
('allows %s to consume shared contracts without another owner', owner => {
  expect(violations(owner, './partition-contract.js')).toEqual([]);
});

it.each([
  ['partition-discovery.js', './partition-placement.js'],
  ['partition-placement.js', './partition-discovery.js'],
  ['partition-placement.js', './partition-reservations.js'],
  ['partition-placement.js', '../../transport/partition-data-channel.js'],
  ['partition-reservations.js', './resident-partition.js'],
])('rejects owner coupling from %s to %s', (owner, dependency) => {
  expect(violations(owner, dependency)).toMatchObject([
    { reason: 'discovery, placement and reservation owners must remain independent' }
  ]);
});
