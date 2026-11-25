// @vitest-environment node
// The secret-shared harness runs JavaScript only: it refuses a Python requester and a Go share operator.
import { describe, expect, it } from 'vitest';
import { validateSecretSharedConfig, SECRET_SHARED_HOSTS_SCHEMA } from '../../scripts/secret-shared/run.js';
import { createShareAgent } from '../../scripts/secret-shared/share-agent.js';

const operator = (stage, share, machineId, operatorScript = '/opt/doppler/tools/secret-shared/gpu/operator-gpu.js') => ({
  label: `s${stage}-${share}`, machineId, stage, share, agent: ['node', 'share-agent.js', '--session'], identityFile: 'id.json',
  operatorScript, modelDirectory: 'model', listen: '127.0.0.1:0', endpoint: '127.0.0.1:1', workDirectory: 'work' });
const config = (overrides = {}) => ({ schema: SECRET_SHARED_HOSTS_SCHEMA, requester: { machineId: 'r' },
  jsRequester: { script: '/opt/doppler/tools/secret-shared/requester.js', model: 'model' },
  operators: [operator(1, 0, 'a'), operator(1, 1, 'b')], credit: { weights: [1, 1, 1, 1] }, ...overrides });

describe('secret-shared harness is JavaScript only', () => {
  it('accepts a JS requester and JS operators', () => {
    expect(validateSecretSharedConfig(config())).toBeTruthy();
  });

  it('refuses the former Python requester configuration', () => {
    expect(() => validateSecretSharedConfig(config({ python: { command: ['python3'], script: 'requester.py' } }))).toThrow(/Python requester was removed/);
    expect(() => validateSecretSharedConfig(config({ jsRequester: { script: 'requester.py', model: 'model' } }))).toThrow(/has not landed/);
    expect(() => validateSecretSharedConfig(config({ jsRequester: undefined }))).toThrow(/has not landed/);
  });

  it('refuses a Go operator binary in the host file and in the share agent', async () => {
    expect(() => validateSecretSharedConfig(config({ operators: [operator(1, 0, 'a', '/opt/ss-operator'), operator(1, 1, 'b')] })))
      .toThrow(/Go operator is refused/);
    const spawned = [];
    const agent = createShareAgent({ spawnOperator: (...args) => { spawned.push(args); throw Error('not reached'); } });
    await expect(agent.ops.open({ operatorScript: '/opt/ss-operator', plan: '{}', modelDirectory: 'm', stage: 1, share: 0, listen: 'l', token: 't',
      workDirectory: '/nonexistent' })).rejects.toThrow(/operator-refused/);
    expect(spawned).toEqual([]);
  });
});
