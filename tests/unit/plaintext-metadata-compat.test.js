// @vitest-environment node
// A plaintext executor reads the content, so it observes access patterns. Providers on release b8994a35b refuse a
// plaintext policy that omits any of the four items ("Execution privacy binding rejected"); requesters built from
// today's defaults must still be accepted by them.
import { it, expect } from 'vitest';
import { assertAvailableExecutionPolicy, createExecutionPolicy, validatePlaintextHops, EXECUTION_BACKENDS
} from '../../packages/reploid/src/chat/execution-policy.js';
import { createInference } from '../../packages/reploid/src/inference/index.js';
import { PROTECTED_METADATA } from '../../packages/reploid/src/inference/protected.js';
import { DEFAULT_ASK_EXECUTION } from '../../server/native-node-ask.js';
import { STANDARD_HTTP_EXECUTION } from '../../server/text-request-options.js';
import { policyForPreset } from '../../apps/poolday/ui/pool-home/privacy-controls.js';

const FOUR = ['model-id', 'timing', 'length', 'access-patterns'];
const identity = 'sha256:' + 'a'.repeat(64);
const remote = recipient => [{ recipient, placement: 'remote', disclosure: 'plaintext' }];

/** The b8994a35b provider rule, reconstructed: every remote plaintext hop needs plaintext plus all four items. */
function releasedValidatePlaintextHops(policy, hops) {
  for (const hop of hops) {
    if (hop.placement === 'local') continue;
    if (!(policy.leakage.includes('plaintext') && FOUR.every(item => policy.leakage.includes(item)))) {
      throw new Error('Execution privacy: plaintext backend exceeds permitted leakage');
    }
  }
  return hops;
}

/** The policy a requester's prepare() compiles from the given requirements, for a remote plaintext route. */
async function preparedPolicy(execution, backend = 'doppler-plaintext/v1') {
  let policy = null;
  const inference = createInference({
    resolveRoute: input => {
      policy = input.policy;
      return backend === 'doppler-partition-plaintext/v1'
        ? { shape: 'split', backend, participants: ['peer:a', 'peer:b'], selection: 'all', maxCharge: { kind: 'free' } }
        : { shape: 'remote', backend, participants: ['peer:a'], selection: 'one-of', maxCharge: { kind: 'free' } };
    },
    execute: async () => { throw new Error('not reached'); }
  });
  const plan = await inference.prepare({ model: { id: 'm', identity }, execution });
  expect(plan.disclosure.metadata.items).toEqual(FOUR);
  return policy;
}

it('both plaintext backends disclose access patterns; the protected backend does not', () => {
  for (const backend of ['doppler-plaintext/v1', 'doppler-partition-plaintext/v1']) expect(EXECUTION_BACKENDS[backend].metadata).toEqual(FOUR);
  expect(PROTECTED_METADATA).not.toContain('access-patterns');
});

it('the repo validator still requires all four items for a remote plaintext hop', () => {
  const policy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
  expect(validatePlaintextHops(policy, remote('peer:a'))).toHaveLength(1);
  for (const item of FOUR) {
    const narrowed = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] },
      leakage: [...FOUR.filter(other => other !== item), 'plaintext'] });
    expect(() => validatePlaintextHops(narrowed, remote('peer:a'))).toThrow('plaintext backend exceeds permitted leakage');
    expect(() => releasedValidatePlaintextHops(narrowed, remote('peer:a'))).toThrow('plaintext backend exceeds permitted leakage');
  }
});

it.each([
  ['reploid ask', DEFAULT_ASK_EXECUTION, 'doppler-plaintext/v1'],
  ['HTTP adapters without an extension', STANDARD_HTTP_EXECUTION, 'doppler-plaintext/v1'],
  ['a split route under the HTTP default', STANDARD_HTTP_EXECUTION, 'doppler-partition-plaintext/v1'],
  ['a named provider', { ...DEFAULT_ASK_EXECUTION, participants: { kind: 'named', ids: ['peer:a', 'peer:b'] } }, 'doppler-plaintext/v1']
])('a requester built from the %s defaults is accepted by a b8994a35b provider', async (_name, execution, backend) => {
  expect(execution.allowMetadata).toEqual(FOUR);
  const policy = await preparedPolicy(structuredClone(execution), backend);
  const hops = remote('peer:a');
  expect(releasedValidatePlaintextHops(assertAvailableExecutionPolicy(policy), hops)).toBe(hops);
  expect(validatePlaintextHops(policy, hops)).toHaveLength(1);
});

it('the browser Standard and Only-your-devices presets compile to policies a b8994a35b provider accepts', () => {
  const standard = policyForPreset('standard', null);
  const own = policyForPreset('own-devices', null, ['peer:desk']);
  for (const [policy, recipient] of [[standard, 'peer:a'], [own, 'peer:desk']]) {
    expect(FOUR.every(item => policy.leakage.includes(item))).toBe(true);
    expect(() => releasedValidatePlaintextHops(policy, remote(recipient))).not.toThrow();
    expect(validatePlaintextHops(policy, remote(recipient))).toHaveLength(1);
  }
});
