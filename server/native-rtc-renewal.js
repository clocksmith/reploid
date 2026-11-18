import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createNativeRtcConfigReader } from './native-rtc-config.js';
import firebase from '../shared/config/firebase-public.json' with { type: 'json' };
import bootstrap from '../shared/config/swarm-bootstrap.json' with { type: 'json' };

async function atomicWrite(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

/** Dedicated native anonymous Firebase identity. No administrator or TURN signing secrets. */
export function createNativeRtcRenewal(directory, { fetcher = fetch } = {}) {
  if (!path.isAbsolute(directory)) throw new Error('RTC state directory must be absolute');
  const stateFile = path.join(directory, 'identity.json');
  const rtcFile = path.join(directory, 'rtc.json');
  async function request(url, options) {
    let response;
    try { response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('RTC issuer connection failed'); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`RTC issuer returned HTTP ${response.status}`); }
    // Bound token/credential responses; never echo remote bodies or credentials.
    const reader = response.body.getReader(); let size = 0; const chunks = [];
    try {
      for (;;) { const item = await reader.read(); if (item.done) break;
        size += item.value.length; if (size > 32768) throw new Error('RTC issuer response too large'); chunks.push(item.value); }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new Error('RTC issuer returned invalid JSON'); }
    } finally { await reader.cancel(); }
  }
  return async () => {
    await fs.mkdir(directory, { mode: 0o700, recursive: true });
    const dir = await fs.lstat(directory);
    if (!dir.isDirectory() || dir.uid !== process.getuid() || (dir.mode & 0o7777) !== 0o700) throw new Error('RTC directory must be owner-owned mode 0700');
    let identity;
    try {
      const handle = await fs.open(stateFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o600 || stat.size > 32768) throw new Error('RTC identity file permissions or size invalid');
        identity = JSON.parse(await handle.readFile('utf8'));
      } finally { await handle.close(); }
    } catch (error) { if (error.code !== 'ENOENT') throw new Error('RTC identity unavailable or invalid'); }
    let token; let refreshToken;
    if (identity) {
      if (typeof identity.refreshToken !== 'string' || !identity.refreshToken) throw new Error('RTC identity missing refresh token');
      const data = await request(`https://securetoken.googleapis.com/v1/token?key=${firebase.apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: identity.refreshToken }).toString()
      }); token = data.id_token; refreshToken = data.refresh_token;
    } else {
      const data = await request(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebase.apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true })
      }); token = data.idToken; refreshToken = data.refreshToken;
    }
    if (typeof token !== 'string' || !token || typeof refreshToken !== 'string' || !refreshToken) throw new Error('RTC authentication response invalid');
    await atomicWrite(stateFile, { refreshToken });
    const payload = await request(bootstrap.rtcConfigUrl, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://replo.id' } });
    const candidate = path.join(directory, `candidate-${randomUUID()}.json`);
    try {
      await atomicWrite(candidate, payload);
      await createNativeRtcConfigReader(candidate)();
      await fs.rename(candidate, rtcFile);
    } finally { await fs.rm(candidate, { force: true }); }
    return { expiresAt: payload.expiresAt, rtcFile };
  };
}
