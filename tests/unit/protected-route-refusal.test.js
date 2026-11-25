// @vitest-environment node
// The protected route's Go engine and key holder are removed: the Node host ports refuse instead of spawning a binary.
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createNodeProtectedExecution, refuseKeyHolder, PROTECTED_KEY_HOLDER_UNAVAILABLE } from '../../server/protected-route/requester-host.js';
import { startProtectedEvaluatorPeer } from '../../server/protected-route/evaluator-peer.js';

const run = promisify(execFile);
const repo = fileURLToPath(new URL('../../', import.meta.url));

describe('protected route without the Go engine', () => {
  it('refuses to open a key holder unless a JavaScript one is supplied', async () => {
    await expect(refuseKeyHolder()).rejects.toMatchObject({ code: PROTECTED_KEY_HOLDER_UNAVAILABLE });
    expect(() => createNodeProtectedExecution({ endpoints: [], policy: {} })).not.toThrow(/spawn/);
  });

  it('refuses to start an evaluator peer without an engine port', async () => {
    await expect(startProtectedEvaluatorPeer({ engine: '/usr/local/bin/privacy-protected', profile: 'research-n16', identity: {} }))
      .rejects.toMatchObject({ code: 'PROTECTED_ENGINE_UNAVAILABLE' });
  });

  it('refuses the two-machine script and the evaluator command line', async () => {
    for (const script of ['scripts/protected-route-e2e.js', 'server/protected-route/evaluator-peer.js']) {
      const failure = await run(process.execPath, [script, 'run', '--engine', 'privacy-protected'], { cwd: repo }).catch(error => error);
      expect(failure.code).toBe(2);
      expect(failure.stderr).toMatch(/refused.*JavaScript only/s);
    }
  });
});
