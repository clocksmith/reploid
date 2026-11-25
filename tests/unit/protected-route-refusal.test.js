// @vitest-environment node
// The protected route's Node host ports run Doppler's JavaScript tooling only when a host names a Doppler checkout.
// Without one they refuse; there is no default engine, key holder or binary.
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createNodeProtectedExecution, refuseKeyHolder, PROTECTED_KEY_HOLDER_UNAVAILABLE } from '../../server/protected-route/requester-host.js';
import { startProtectedEvaluatorPeer } from '../../server/protected-route/evaluator-peer.js';
import { createDopplerEvaluatorEngine } from '../../server/protected-route/doppler-evaluator.js';
import { openDopplerKeyHolder } from '../../server/protected-route/doppler-key-holder.js';
import { resolveDopplerProtected, DOPPLER_PROTECTED_UNAVAILABLE } from '../../server/protected-route/doppler-tooling.js';

const run = promisify(execFile);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const missing = fileURLToPath(new URL('../../does-not-exist/', import.meta.url));

describe('protected route without a Doppler checkout', () => {
  it('refuses to open a key holder unless a Doppler checkout or a host key holder is supplied', async () => {
    await expect(refuseKeyHolder()).rejects.toMatchObject({ code: PROTECTED_KEY_HOLDER_UNAVAILABLE });
    expect(() => createNodeProtectedExecution({ endpoints: [], policy: {} })).not.toThrow(/spawn/);
    await expect(openDopplerKeyHolder({ doppler: missing, profile: 'research-n16-u32' })).rejects.toMatchObject({ code: DOPPLER_PROTECTED_UNAVAILABLE });
  });

  it('refuses a directory without Doppler\'s protected tooling', () => {
    expect(() => resolveDopplerProtected(missing)).toThrow(expect.objectContaining({ code: DOPPLER_PROTECTED_UNAVAILABLE }));
    expect(() => resolveDopplerProtected(null)).toThrow(expect.objectContaining({ code: DOPPLER_PROTECTED_UNAVAILABLE }));
    expect(() => createDopplerEvaluatorEngine({ doppler: missing, profile: 'research-n16-u32', evaluator: '127.0.0.1:1' }))
      .toThrow(expect.objectContaining({ code: DOPPLER_PROTECTED_UNAVAILABLE }));
  });

  it('refuses to start an evaluator peer without an engine port, and the vanishing attack it has no engine for', async () => {
    await expect(startProtectedEvaluatorPeer({ engine: '/usr/local/bin/privacy-protected', profile: 'research-n16', identity: {} }))
      .rejects.toMatchObject({ code: 'PROTECTED_ENGINE_UNAVAILABLE' });
    const engine = { describe: async () => ({}), open: async () => ({}), stop: () => {} };
    await expect(startProtectedEvaluatorPeer({ engine, profile: 'research-n16-u32', identity: {}, misbehave: 'vanish:trapset.json' }))
      .rejects.toMatchObject({ code: 'PROTECTED_ENGINE_UNAVAILABLE' });
  });

  it('the fleet script and the evaluator command line refuse to run without their Doppler inputs', async () => {
    for (const [script, args] of [['scripts/protected-route-e2e.js', ['run', '--pins', 'pins.json']], ['scripts/protected-route-e2e.js', []],
      ['server/protected-route/evaluator-peer.js', ['--profile', 'research-n16-u32']]]) {
      const failure = await run(process.execPath, [script, ...args], { cwd: repo }).catch(error => error);
      expect(failure.code).toBe(2);
      expect(failure.stderr).toMatch(/needs --doppler|usage:/);
    }
  });
});
