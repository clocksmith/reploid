// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readNativeRoomTokenFile, resolveNativeRoomToken } from '../../server/native-participant.js';
import { createRoomIntroductionAdmission } from '../../packages/reploid/src/transport/index.js';

const run = promisify(execFile);
const script = new URL('../../server/native-participant.js', import.meta.url).pathname;
const TOKEN = 'private-room-capability-'.padEnd(48, 'z');
const WARNING = 'Warning: --room-token exposes the room token in process arguments; use --room-token-file';
let root;

beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'room-token-file-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

async function tokenFile(content, mode = 0o600, name = 'room-token') {
  const file = path.join(root, name);
  await fs.writeFile(file, content, { mode });
  await fs.chmod(file, mode); // umask cannot widen or narrow the mode under test
  return file;
}
// Modules are absent absolute paths: a run that passes token resolution fails at module import,
// never connects, and leaves only a temporary identity in this directory.
const identity = () => path.join(root, 'identity.json');
const cli = extra => run(process.execPath, [script, '--connect-only', '--model', 'unused', '--model-directory', root,
  '--identity-file', identity(), '--rtc-module', '/must-not-import-rtc', '--ws-module', '/must-not-import-ws', ...extra],
{ timeout: 10000 }).then(result => ({ code: 0, ...result }), error => error);
const noIdentity = () => expect(fs.stat(identity())).rejects.toMatchObject({ code: 'ENOENT' });

describe('native --room-token-file', () => {
  it('advertises the file option in --help', async () => {
    const { stdout } = await run(process.execPath, [script, '--help'], { timeout: 10000 });
    expect(stdout).toContain('--room-token-file <absolute path>');
    expect(stdout).toContain('mode 0600');
    expect(stdout).toContain('exposes the token in process');
  });

  it('fails on an absent file before identity, module or connection side effects', async () => {
    const failure = await cli(['--room-token-file', path.join(root, 'missing-token')]);
    expect(failure.code).not.toBe(0);
    expect(failure.stderr).toContain('--room-token-file does not exist');
    await noIdentity();
  });

  it('fails on a relative path', async () => {
    await tokenFile(TOKEN);
    const failure = await cli(['--room-token-file', 'room-token']);
    expect(failure.stderr).toContain('--room-token-file requires an absolute path');
    await noIdentity();
    await expect(readNativeRoomTokenFile('room-token')).rejects.toThrow('requires an absolute path');
  });

  it('fails when the mode is not 0600', async () => {
    for (const mode of [0o644, 0o640, 0o400]) {
      const file = await tokenFile(TOKEN, mode, `token-${mode.toString(8)}`);
      const failure = await cli(['--room-token-file', file]);
      expect(failure.stderr).toContain(`must have mode 0600 (owner read/write only), not ${mode.toString(8).padStart(4, '0')}`);
      expect(failure.stderr).not.toContain(TOKEN);
      await noIdentity();
    }
  });

  it('fails when both --room-token and --room-token-file are supplied', async () => {
    const file = await tokenFile(TOKEN);
    const failure = await cli(['--room-token', TOKEN, '--room-token-file', file]);
    expect(failure.stderr).toContain('Choose either --room-token or --room-token-file, not both');
    expect(failure.stderr).not.toContain(WARNING);
    await noIdentity();
    await expect(resolveNativeRoomToken({ 'room-token': TOKEN, 'room-token-file': file })).rejects.toThrow('not both');
  });

  it('accepts an owner-only regular file and continues startup without a warning or the token on stderr', async () => {
    const file = await tokenFile(TOKEN);
    expect(await readNativeRoomTokenFile(file)).toBe(TOKEN);
    const failure = await cli(['--room-token-file', file]);
    // Startup passed token resolution and stopped at the deliberately absent RTC module.
    expect(failure.stderr).toContain('must-not-import-rtc');
    expect(failure.stderr).not.toContain('--room-token-file');
    expect(failure.stderr).not.toContain(WARNING);
    expect(`${failure.stdout}${failure.stderr}`).not.toContain(TOKEN);
  });

  it('trims exactly one trailing newline', async () => {
    expect(await readNativeRoomTokenFile(await tokenFile(`${TOKEN}\n`, 0o600, 'lf'))).toBe(TOKEN);
    expect(await readNativeRoomTokenFile(await tokenFile(`${TOKEN}\r\n`, 0o600, 'crlf'))).toBe(TOKEN);
    expect(await readNativeRoomTokenFile(await tokenFile(`${TOKEN}\n\n`, 0o600, 'two'))).toBe(`${TOKEN}\n`);
    expect(await readNativeRoomTokenFile(await tokenFile(` ${TOKEN} \n`, 0o600, 'spaces'))).toBe(` ${TOKEN} `);
  });

  it('rejects an empty file, another owner, a symbolic link and a directory', async () => {
    await expect(readNativeRoomTokenFile(await tokenFile('\n', 0o600, 'empty'))).rejects.toThrow('--room-token-file is empty');
    const file = await tokenFile(TOKEN);
    const uid = process.getuid();
    await expect(readNativeRoomTokenFile(file, { uid: uid + 1 })).rejects.toThrow(`must be owned by the current user (uid ${uid + 1}), not uid ${uid}`);
    const link = path.join(root, 'link');
    await fs.symlink(file, link);
    await expect(readNativeRoomTokenFile(link)).rejects.toThrow('is a symbolic link, not a regular file');
    const directory = path.join(root, 'directory');
    await fs.mkdir(directory, { mode: 0o700 });
    await expect(readNativeRoomTokenFile(directory)).rejects.toThrow('must be a regular file');
  });

  it('validates a file token exactly as a --room-token value', async () => {
    const file = await tokenFile(`${TOKEN}\n`);
    const warnings = [];
    const inline = await resolveNativeRoomToken({ 'room-token': TOKEN }, { warn: message => warnings.push(message) });
    expect(await resolveNativeRoomToken({ 'room-token-file': file }, { warn: message => warnings.push(message) })).toBe(inline);
    expect(warnings).toEqual([WARNING]);
    expect(warnings[0]).not.toContain(TOKEN);
    // A short token is not rejected by the file reader; the shared private-room admission rejects both sources alike.
    const short = await resolveNativeRoomToken({ 'room-token-file': await tokenFile('short\n', 0o600, 'short') });
    expect(() => createRoomIntroductionAdmission({ roomId: 'reploid-swarm-journey', token: short })).toThrow('Private introduction room capability required');
    expect(() => createRoomIntroductionAdmission({ roomId: 'reploid-swarm-journey', token: 'short' })).toThrow('Private introduction room capability required');
  });

  it('keeps --room-token working with one warning line on stderr', async () => {
    const result = await cli(['--room-token', TOKEN]);
    expect(result.stderr.split('\n').filter(line => line === WARNING)).toHaveLength(1);
    expect(result.stderr).toContain('must-not-import-rtc');
  });
});
