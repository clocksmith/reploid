// @vitest-environment node
import { it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNativeRtcConfigReader } from '../../server/native-rtc-config.js';
const dirs = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
const payload = (credential = 'short-lived') => ({ schema: 'reploid.pool.turn_credentials/v1', expiresAt: new Date(200000).toISOString(),
  rtcConfig: { iceTransportPolicy: 'relay', iceServers: [{ urls: 'turns:turn.example.test:443?transport=tcp', username: 'temporary', credential }] } });
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'native-rtc-')); dirs.push(dir);
  const file = path.join(dir, 'rtc.json'); await fs.writeFile(file, JSON.stringify(payload()), { mode: 0o600 });
  return { dir, file, read: createNativeRtcConfigReader(file, { now: () => 100000 }) };
}
it('rereads rotating credentials without retaining an expired configuration', async () => {
  const { file, read } = await fixture(); expect((await read()).iceServers[0].credential).toBe('short-lived');
  await fs.writeFile(file + '.next', JSON.stringify(payload('renewed')), { mode: 0o600 }); await fs.rename(file + '.next', file);
  expect((await read()).iceServers[0].credential).toBe('renewed');
  const expired = payload(); expired.expiresAt = new Date(100001).toISOString(); await fs.writeFile(file, JSON.stringify(expired));
  await expect(read()).rejects.toThrow('expire');
});
it('rejects permissive files and symlinks', async () => {
  const { dir, file, read } = await fixture(); await fs.chmod(file, 0o644); await expect(read()).rejects.toThrow('0600');
  await fs.chmod(file, 0o600); const link = path.join(dir, 'link'); await fs.symlink(file, link);
  await expect(createNativeRtcConfigReader(link)()).rejects.toThrow('unavailable');
});
it('rejects bad owner, oversized input and malformed JSON without leaking contents', async () => {
  const { file, read } = await fixture(); await expect(createNativeRtcConfigReader(file, { uid: process.getuid() + 1 })()).rejects.toThrow('owner');
  await fs.writeFile(file, 'x'.repeat(32769)); await expect(read()).rejects.toThrow('size');
  await fs.writeFile(file, 'SECRET'); await expect(read()).rejects.toThrow('invalid JSON');
});
it.each(['missing-relay', 'missing-password', 'policy', 'expiry', 'schema'])('fails closed on %s', async kind => {
  const { file, read } = await fixture(); const data = payload();
  if (kind === 'missing-relay') data.rtcConfig.iceServers[0].urls = 'stun:stun.example.test';
  if (kind === 'missing-password') delete data.rtcConfig.iceServers[0].credential;
  if (kind === 'policy') data.rtcConfig.iceTransportPolicy = 'invalid';
  if (kind === 'expiry') data.expiresAt = 'invalid';
  if (kind === 'schema') data.schema = 'invalid';
  await fs.writeFile(file, JSON.stringify(data)); await expect(read()).rejects.toThrow();
});
