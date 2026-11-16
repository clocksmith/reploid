// @vitest-environment node
import { expect, it } from 'vitest';
import { artifactAdditionViolation } from '../../scripts/check-artifact-additions.js';

const policy = { generatedRoots: ['artifacts/', 'reports/local/'], maxNewBlobBytes: 1024,
  maxArchiveBytes: 2048, exceptions: [] };
const options = { policy, currentArchive: 'deploy/artifacts/current.tgz' };

it('keeps new run outputs and historical binaries out of ordinary source commits', () => {
  expect(artifactAdditionViolation('src/example.js', 100, options)).toBeNull();
  expect(artifactAdditionViolation('artifacts/run/trace.json', 10, options)).toContain('retain new run output');
  expect(artifactAdditionViolation('deploy/artifacts/old.tgz', 100, options)).toContain('current integrity-pinned');
  expect(artifactAdditionViolation('deploy/artifacts/current.tgz', 1024, options)).toBeNull();
  expect(artifactAdditionViolation('deploy/artifacts/current.tgz', 2049, options)).not.toBeNull();
  expect(artifactAdditionViolation('src/dump.bin', 1025, options)).toContain('source budget');
});

it('requires a bounded, explained exception for an intentionally retained artifact', () => {
  const file = 'artifacts/retained/receipt.json';
  const reviewed = { ...options, policy: { ...policy, exceptions: [{ path: file, reason: 'Reproduction receipt', maxBytes: 100 }] } };
  expect(artifactAdditionViolation(file, 100, reviewed)).toBeNull();
  expect(artifactAdditionViolation(file, 101, reviewed)).not.toBeNull();
  reviewed.policy.exceptions[0].reason = '';
  expect(artifactAdditionViolation(file, 100, reviewed)).not.toBeNull();
});
