// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { assertLongReference, createRedactor, loadPhysicalConfig, resolveRunWindow, validatePhysicalConfig } from '../../scripts/stage1/physical-config.js';
import { createSshTransport, openAgentSession, parseControlReply, shellQuote, sshArguments } from '../../scripts/stage1/command-transport.js';
import { runPhysicalStage1 } from '../../scripts/stage1/run.js';

const target = (letter, extra = {}) => ({ machineId: 'm-' + letter.repeat(16), participantId: 'peer:' + letter.repeat(24),
  ssh: `operator@alpha-${letter}`, node: '/opt/node/bin/node', releaseRoot: `/srv/release-${letter}`, identityFile: `/srv/state-${letter}/identity.json`,
  stateDirectory: `/srv/state-${letter}/run`, ...extra });
const host = (label, letter, extra = {}) => ({ label, ...target(letter), stageDirectory: `/data/${letter}/stage`, fullCopyDirectory: `/data/${letter}/tmp/full`,
  weightRoots: { model: [`/data/${letter}/models`], cache: [`/data/${letter}/cache`], temporary: [`/data/${letter}/tmp`] },
  memoryPressure: { maxAvg10: 10, pollMs: 1000 }, standingService: { manager: 'systemd-user', unit: 'private-worker.service', approveStopForSolo: false }, ...extra });
const config = () => ({ schema: 'reploid.stage1-hosts/v1',
  coordinator: { listenHost: '10.9.8.7', publicHost: '10.9.8.7', servicePort: 18443, signalingPort: 18444,
    tls: { keyFile: '/srv/tls/key.pem', certFile: '/srv/tls/cert.pem', caFile: '/srv/tls/ca.pem' } },
  credit: { weights: [16, 84], maxDebt: 1000, maxRequestMs: 600000 },
  limits: { phaseMs: 600000, abortGraceMs: 15000, hardStopMs: 90000, stopMarginMs: 120000, serviceRestoreMs: 30000 },
  requester: { ...target('c'), modelDirectory: '/srv/requester/empty' }, hosts: [host('host-a', 'a'), host('host-b', 'b')] });

describe('the private host file', () => {
  it('accepts a complete configuration', () => { expect(validatePhysicalConfig(config()).hosts).toHaveLength(2); });

  it.each([
    ['an unknown field', c => { c.hosts[0].approveStop = true; }, 'unknown field'],
    ['a missing field', c => { delete c.hosts[1].weightRoots; }, 'weightRoots'],
    ['a readable machine name as its ID', c => { c.hosts[0].machineId = 'my-desktop'; }, 'machineId'],
    ['two hosts on one machine', c => { c.hosts[1].machineId = c.hosts[0].machineId; }, 'machineId'],
    ['the requester on an executing machine', c => { c.requester.machineId = c.hosts[0].machineId; }, 'machineId'],
    ['one identity twice', c => { c.hosts[1].participantId = c.hosts[0].participantId; }, 'participantId'],
    ['an option injected as an SSH target', c => { c.hosts[0].ssh = '-oProxyCommand=x'; }, 'ssh'],
    ['a stage host without a target', c => { c.hosts[0].ssh = null; }, 'ssh'],
    ['a relative path', c => { c.hosts[0].stageDirectory = 'data/stage'; }, 'stageDirectory'],
    ['a path that climbs', c => { c.hosts[0].stageDirectory = '/data/a/../b'; }, 'stageDirectory'],
    ['a shell character in a path', c => { c.hosts[0].stageDirectory = '/data/$(x)'; }, 'stageDirectory'],
    ['a full copy over the stage', c => { c.hosts[0].fullCopyDirectory = '/data/a'; }, 'overlaps'],
    ['a full copy containing a weight root', c => { c.hosts[0].fullCopyDirectory = '/data/a/models-root'; c.hosts[0].weightRoots.model = ['/data/a/models-root/x']; }, 'contains a weight root'],
    ['a non-boolean service approval', c => { c.hosts[0].standingService.approveStopForSolo = 'yes'; }, 'approveStopForSolo'],
    ['a pattern as a service', c => { c.hosts[0].standingService.unit = '*.service'; }, 'unit'],
    ['an unsupported manager', c => { c.hosts[0].standingService.manager = 'launchd'; }, 'manager'],
    ['one credit weight', c => { c.credit.weights = [1]; }, 'weights'],
    ['a zero credit weight', c => { c.credit.weights = [0, 1]; }, 'weights'],
    ['a margin shorter than the hard stop', c => { c.limits.stopMarginMs = 1000; }, 'stopMarginMs'],
    ['a hard stop shorter than a restore', c => { c.limits.hardStopMs = 1000; }, 'hardStopMs']
  ])('refuses %s', (_name, change, field) => {
    const value = config(); change(value);
    expect(() => validatePhysicalConfig(value)).toThrow(field);
  });

  it('never repeats a value in its error', () => {
    const value = config(); value.hosts[0].ssh = '-secret-target-value';
    expect(() => validatePhysicalConfig(value)).toThrow(/^(?!.*secret-target-value)/);
  });

  describe('on disk', () => {
    let directory;
    beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stage1-config-')); });
    afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

    it('reads only an owner-private regular file', async () => {
      const file = path.join(directory, 'hosts.json');
      await fs.writeFile(file, JSON.stringify(config()), { mode: 0o600 });
      expect((await loadPhysicalConfig(file)).schema).toBe('reploid.stage1-hosts/v1');
      await fs.chmod(file, 0o644);
      await expect(loadPhysicalConfig(file)).rejects.toThrow('private to its owner');
      await fs.chmod(file, 0o600);
      const link = path.join(directory, 'link.json');
      await fs.symlink(file, link);
      await expect(loadPhysicalConfig(link)).rejects.toThrow('regular file');
    });

    it('does not quote the file when it cannot parse it', async () => {
      const file = path.join(directory, 'broken.json');
      await fs.writeFile(file, '{"token": "credential-in-file" oops', { mode: 0o600 });
      const error = await loadPhysicalConfig(file).catch(value => value);
      expect(error.message).toContain('not valid JSON');
      expect(error.message).not.toContain('credential-in-file');
    });
  });

  it('removes every private value from output, keeping the opaque IDs', () => {
    const value = config(), redactor = createRedactor(value);
    redactor.add('room-token-value');
    const text = redactor.text(`ssh operator@alpha-a failed at /data/a/stage for private-worker.service via 10.9.8.7 wss://x/swarm?access_token=abc123 room-token-value ${value.hosts[0].machineId}`);
    for (const secret of ['operator', 'alpha-a', '/data/a/stage', 'private-worker', '10.9.8.7', 'abc123', 'room-token-value']) expect(text).not.toContain(secret);
    expect(text).toContain(value.hosts[0].machineId);
  });
});

describe('receipt redaction', () => {
  const digest = 'sha256:00cafe00host00';
  it('leaves digests and labels exact when an alias is a common substring', () => {
    const value = config(); value.hosts[0].ssh = 'cafe'; value.hosts[1].ssh = 'host';
    const redactor = createRedactor(value);
    const receipt = { hosts: [{ label: 'host-a', inventory: { preflight: { rangesDigest: digest } } }],
      phases: { split: { status: 'failed', reason: 'cafe refused at /data/a/stage/shard.bin. host dropped; host-a stayed' } },
      hardStop: { reason: 'lost cafe' }, soloControls: { 'host-a': { reason: 'host unreachable' } } };
    const clean = redactor.receipt(receipt);
    expect(clean.hosts[0]).toEqual(receipt.hosts[0]);
    expect(clean.phases.split.reason).toBe('[private] refused at [private]/shard.bin. [private] dropped; host-a stayed');
    expect(clean.hardStop.reason).toBe('lost [private]');
    expect(clean.soloControls['host-a'].reason).toBe('[private] unreachable');
    expect(receipt.hardStop.reason).toBe('lost cafe');
  });
  it('removes a path at the end of a sentence', () => {
    expect(createRedactor(config()).text('missing /data/a/stage.')).toBe('missing [private].');
  });
});

describe('the run window', () => {
  const now = Date.parse('2026-11-24T10:00:00Z');
  it.each([[undefined], [''], ['tomorrow'], ['2026-11-24T12:00:00']])('refuses %s', value => {
    expect(() => resolveRunWindow(value, { now, stopMarginMs: 1000 })).toThrow('window-required');
  });
  it('refuses a window already closed or too short to stop inside', () => {
    expect(() => resolveRunWindow('2026-11-24T09:00:00Z', { now, stopMarginMs: 1000 })).toThrow('window-closed');
    expect(() => resolveRunWindow('2026-11-24T10:01:00Z', { now, stopMarginMs: 120000 })).toThrow('window-closed');
  });
  it('stops the margin before the window ends', () => {
    expect(resolveRunWindow('2026-11-24T11:00:00Z', { now, stopMarginMs: 120000 })).toEqual({ untilMs: now + 3600000, maxRunMs: 3480000 });
  });
  it('contacts no host without a window', async () => {
    const transport = { run: vi.fn(), open: vi.fn() };
    await expect(runPhysicalStage1({ config: config(), transport, directory: '/tmp/unused' })).rejects.toThrow('window-required');
    expect(transport.run).not.toHaveBeenCalled();
    expect(transport.open).not.toHaveBeenCalled();
  });
});

describe('a longer frozen reference', () => {
  const fixture = count => ({ maxOutputTokens: count, reference: { visibleOutputIds: Array.from({ length: count - 1 }, (_, id) => id + 1), stopId: 9, outputText: 'text' } });
  it.each([64, 128])('accepts %i tokens', count => { expect(assertLongReference(fixture(count))).toBe(count); });
  it.each([63, 129])('refuses %i tokens', count => { expect(() => assertLongReference(fixture(count))).toThrow('fixture-invalid'); });
  it('refuses a limit below its own length', () => {
    expect(() => assertLongReference({ ...fixture(64), maxOutputTokens: 63 })).toThrow('fixture-invalid');
  });
});

describe('the command transport', () => {
  const child = () => Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });

  it('quotes every remote argument and puts no credential on the command line', () => {
    expect(shellQuote("it's; rm -rf /")).toBe("'it'\\''s; rm -rf /'");
    const args = sshArguments({ ssh: 'alias' }, ['/opt/node', '/srv/a b/agent.js', '--control']);
    expect(args.slice(0, 3)).toEqual(['-T', '-o', 'BatchMode=yes']);
    expect(args.at(-3)).toBe('--');
    expect(args.at(-2)).toBe('alias');
    expect(args.at(-1)).toBe("'/opt/node' '/srv/a b/agent.js' '--control'");
  });

  it('sends the request on standard input through an injected spawn', async () => {
    const process = child(), spawn = vi.fn(() => process), input = [];
    process.stdin.on('data', chunk => input.push(String(chunk)));
    const running = createSshTransport({ spawn }).run({ ssh: 'alias' }, ['node', 'agent', '--control'], { input: '{"op":"x"}', timeoutMs: 1000 });
    process.stdout.write('{"result":1}\n');
    await new Promise(resolve => setImmediate(resolve));
    process.emit('close', 0);
    expect(await running).toMatchObject({ code: 0, stdout: '{"result":1}\n' });
    expect(spawn.mock.calls[0][0]).toBe('ssh');
    expect(spawn.mock.calls[0][1].join(' ')).not.toContain('"op"');
    expect(input.join('')).toBe('{"op":"x"}');
  });

  it('kills a command that outlives its timeout', async () => {
    const process = child();
    await expect(createSshTransport({ spawn: () => process }).run({ ssh: 'alias' }, ['node'], { timeoutMs: 5 })).rejects.toThrow('timed out');
    expect(process.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('reads the last JSON line and reports anything else as no reply', () => {
    expect(parseControlReply('noise\n{"result":2}\n')).toEqual({ result: 2 });
    expect(parseControlReply('not json')).toBeNull();
  });

  it('fails calls in flight when the agent exits', async () => {
    const process = child(), session = openAgentSession(process);
    process.stdout.write(JSON.stringify({ event: 'agent', pid: 42, startId: 'start', harnessDigest: 'sha256:x' }) + '\n');
    await session.hello;
    expect(session).toMatchObject({ pid: 42, startId: 'start' });
    const call = session.call('state');
    process.emit('exit', 1);
    await expect(call).rejects.toThrow('exited');
  });
});
