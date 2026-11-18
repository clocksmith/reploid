// @vitest-environment node
import { it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNativeRtcRenewal } from '../../server/native-rtc-renewal.js';
const dirs = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
async function setup() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rtc-renewal-')); dirs.push(dir); return dir; }
const credentials = () => ({ schema: 'reploid.pool.turn_credentials/v1', expiresAt: new Date(Date.now() + 600000).toISOString(),
  rtcConfig: { iceTransportPolicy: 'all', iceServers: [{ urls: 'turns:turn.cloudflare.com:443?transport=tcp', username: 'temporary', credential: 'temporary-secret' }] } });
it('signs in once, persists owner-only refresh identity, and renews using the same identity', async () => {
  const dir = await setup(); const calls = [];
  const fetcher = vi.fn(async (url, opts) => { calls.push([url, opts]);
    if (url.includes('accounts:signUp')) return Response.json({ idToken: 'test-token', refreshToken: 'test-refresh' });
    if (url.includes('securetoken')) return Response.json({ id_token: 'renewed-token', refresh_token: 'renewed-refresh' });
    return Response.json(credentials()); });
  const renew = createNativeRtcRenewal(dir, { fetcher });
  await renew(); await renew();
  expect(calls.filter(([url]) => url.includes('signUp'))).toHaveLength(1);
  expect(calls[2][1].body).toContain('refresh_token=test-refresh');
  expect(calls[3][1].headers.Authorization).toBe('Bearer renewed-token');
  for (const name of ['identity.json', 'rtc.json']) expect((await fs.stat(path.join(dir, name))).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await fs.readFile(path.join(dir, 'identity.json'), 'utf8')).refreshToken).toBe('renewed-refresh');
  expect(await fs.readdir(dir)).toEqual(['identity.json', 'rtc.json']);
});
it('rejects invalid replacement and keeps prior RTC file', async () => {
  const dir = await setup(); let invalid = false;
  const fetcher = async url => url.includes('signUp') ? Response.json({ idToken: 'a', refreshToken: 'b' }) : url.includes('securetoken')
    ? Response.json({ id_token: 'a', refresh_token: 'b' }) : Response.json(invalid ? { secret: 'not logged' } : credentials());
  const renew = createNativeRtcRenewal(dir, { fetcher }); await renew(); const old = await fs.readFile(path.join(dir, 'rtc.json'), 'utf8'); invalid = true;
  await expect(renew()).rejects.toThrow('schema'); expect(await fs.readFile(path.join(dir, 'rtc.json'), 'utf8')).toBe(old);
});
it('does not replace revoked identities by silently creating new accounts', async () => {
  const dir = await setup(); await fs.writeFile(path.join(dir, 'identity.json'), JSON.stringify({ refreshToken: 'revoked' }), { mode: 0o600 });
  const fetcher = vi.fn(async () => new Response('private error', { status: 400 }));
  await expect(createNativeRtcRenewal(dir, { fetcher })()).rejects.toThrow('HTTP 400'); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects unsafe directory or symlinked identity before authentication', async () => {
  const dir = await setup(); const fetcher = vi.fn(); await fs.chmod(dir, 0o755);
  await expect(createNativeRtcRenewal(dir, { fetcher })()).rejects.toThrow('0700'); await fs.chmod(dir, 0o700);
  await fs.symlink('/dev/null', path.join(dir, 'identity.json'));
  await expect(createNativeRtcRenewal(dir, { fetcher })()).rejects.toThrow('invalid'); expect(fetcher).not.toHaveBeenCalled();
});
it('bounds remote responses and never prints returned secrets', async () => {
  const dir = await setup(); const fetcher = async () => new Response('SECRET'.repeat(6000));
  await expect(createNativeRtcRenewal(dir, { fetcher })()).rejects.toThrow('too large');
});
