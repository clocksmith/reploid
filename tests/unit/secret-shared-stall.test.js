// @vitest-environment node
// The secret-shared stall case end to end, with real processes and the real ledger but no model: the fake requester and
// fake operators (tests/fixtures/secret-shared/) speak the harness's command lines and events. One share operator is
// frozen (SIGSTOP) mid-answer. The requester must fail within its round deadline, naming that share; every stage must
// close; the reservation must settle under the current (v3) rules and no credit may stay held.
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { checkSecretShared, runSecretShared, SECRET_SHARED_HOSTS_SCHEMA, STALL_BOUND_SLACK_MS, validateSecretSharedConfig } from '../../scripts/secret-shared/run.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtures = path.join(root, 'tests/fixtures/secret-shared');
const freePort = () => new Promise(resolve => { const server = net.createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });

async function setup({ roundTimeoutMs = 1000, cases }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ss-stall-'));
  const identity = async name => {
    const file = path.join(dir, `${name}.json`);
    await fs.writeFile(file, JSON.stringify(await createSigningIdentity({ algorithm: 'Ed25519' })), { mode: 0o600 });
    return file;
  };
  const plan = { schema: 'doppler.secret-shared-plan/v1', modelId: 'qwen-3-5-0-8b-q4k-ef16-af32-vf16', fx: 20, fw: 24,
    stages: [{ index: 0, layers: [0, 23], groups: [{ id: 'g0', in: 4, tensors: [{ name: 't0', sha256: '0'.repeat(64), shape: [3, 4] }] }] }] };
  const planFile = path.join(dir, 'plan.json');
  await fs.writeFile(planFile, JSON.stringify(plan));
  const operators = [];
  for (const [share, label] of ['op-a', 'op-b'].entries()) {
    const port = await freePort();
    operators.push({ label, machineId: `m-${label}`, stage: 0, share, agent: [process.execPath, path.join(root, 'scripts/secret-shared/share-agent.js'), '--session'],
      identityFile: await identity(label), operatorScript: path.join(fixtures, 'fake-operator.js'), modelDirectory: dir, listen: `127.0.0.1:${port}`,
      endpoint: { host: '127.0.0.1', port }, workDirectory: path.join(dir, `work-${label}`) });
  }
  const config = { schema: SECRET_SHARED_HOSTS_SCHEMA, modelId: plan.modelId, plan: planFile, hiddenSize: 1024,
    requester: { machineId: 'm-requester', identityFile: await identity('requester'), edgeInIdentityFile: await identity('edge-in'), edgeOutIdentityFile: await identity('edge-out') },
    jsRequester: { script: path.join(fixtures, 'fake-requester.js'), model: dir, roundTimeoutMs },
    operators, credit: { weights: [1, 1, 1, 1], maxDebt: 1000, maxOutputTokens: 16, maxRequestMs: 120000, partitionUnclaimedReleaseMs: 60000 },
    limits: { requesterSilenceMs: 30000 }, cases };
  return { dir, config };
}

describe('secret-shared stall case', () => {
  it('refuses a stall case without a stated round deadline, an unknown operator, or speculation on', () => {
    const base = { schema: SECRET_SHARED_HOSTS_SCHEMA, requester: { machineId: 'r' }, jsRequester: { script: '/x/requester.js', model: 'm', roundTimeoutMs: 1000 },
      operators: ['a', 'b'].map((label, share) => ({ label, machineId: label, stage: 0, share, agent: [], identityFile: 'i', operatorScript: '/x/op.js', modelDirectory: 'm',
        listen: 'l', endpoint: 'e', workDirectory: 'w' })), credit: { weights: [1, 1, 1, 1] } };
    const stall = { name: 'stall', prompt: 'p', maxTokens: 4, freezeOperator: 'b', afterTokens: 2 };
    expect(validateSecretSharedConfig({ ...base, cases: [stall] })).toBeTruthy();
    expect(() => validateSecretSharedConfig({ ...base, jsRequester: { ...base.jsRequester, roundTimeoutMs: undefined }, cases: [stall] })).toThrow(/roundTimeoutMs/);
    expect(() => validateSecretSharedConfig({ ...base, cases: [{ ...stall, freezeOperator: 'nobody' }] })).toThrow(/freezeOperator/);
    expect(() => validateSecretSharedConfig({ ...base, jsRequester: { ...base.jsRequester, speculation: 'on' } })).toThrow(/speculation stays off/);
    expect(() => validateSecretSharedConfig({ ...base, cases: [{ name: 'spec', prompt: 'p', maxTokens: 1 }] })).toThrow(/not split, stop, failure or stall/);
  });

  it.skipIf(process.platform === 'win32')('a frozen share operator fails the request within the bound, every stage closes, the ledger settles and holds nothing', async () => {
    const roundTimeoutMs = 1000;
    const { dir, config } = await setup({ roundTimeoutMs, cases: [
      { name: 'split', prompt: 'Explain why the sky is blue in one sentence.', maxTokens: 4 },
      { name: 'stall', prompt: 'Explain why the sky is blue in one sentence.', maxTokens: 10, freezeOperator: 'op-b', afterTokens: 3 }] });
    try {
      const receipt = await runSecretShared({ config, directory: path.join(dir, 'run') });
      expect(receipt.error).toBeNull();
      expect(receipt.split.result.status).toBe('completed');
      const { stall } = receipt;
      expect(stall.result.status).toBe('failed');
      // The freeze lands after the harness has handled token 3; the fake requester's steps are instant, so a few more
      // may finish first. The answer never completes.
      expect(stall.tokens.length).toBeGreaterThanOrEqual(3);
      expect(stall.tokens.length).toBeLessThan(10);
      expect(stall.stall).toMatchObject({ roundTimeoutMs, boundMs: roundTimeoutMs + STALL_BOUND_SLACK_MS, operator: 'op-b', frozen: { stage: 0, share: 1 },
        failedCode: 'operator-stalled', namedTheFrozenShare: true, withinBound: true, requesterSilent: null });
      expect(stall.stall.toFailedMs).toBeGreaterThanOrEqual(roundTimeoutMs - 50);
      // Every stage closed, the frozen one ended by its supervisor with SIGKILL.
      expect(stall.closing.map(row => [row.label, row.status, row.frozen])).toEqual([['op-a', 'failed', false], ['op-b', 'failed', true]]);
      expect(stall.closing[1].operatorExit).toBeNull();
      // v3: the stages all closed, no stop, so the acknowledged prefix is charged; nothing stays held.
      expect(stall.stall.ledger).toMatchObject({ state: 'settled', heldAfterSettle: 0, reason: 'unattributed-disconnect-acknowledged-prefix' });
      expect(stall.settlement).toMatchObject({ state: 'settled', heldAfter: 0 });
      expect(stall.settleError).toBeNull();
      expect(stall.settlement.charge).toBeGreaterThan(0);
      expect(receipt.cleanup).toEqual({ heldCredits: 0, openReservations: 0 });
      const verdict = await checkSecretShared(receipt);
      expect(verdict.problems).toEqual([]);
      expect(verdict.passed).toBe(true);
      expect(verdict.verifyTrade.attempts.map(row => [row.name, row.ok])).toEqual([['split', true], ['stall', true]]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 90000);
});
