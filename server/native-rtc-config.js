import fs from 'node:fs/promises';
import path from 'node:path';
import { requireValue } from './native-host-utils.js';

const MAX_BYTES = 32768;
/** Operator rotates this owner-only file atomically. Credentials never enter logs or argv. */
export function createNativeRtcConfigReader(file, { now = Date.now, uid = process.getuid?.() } = {}) {
  requireValue(typeof file === 'string' && path.isAbsolute(file), 'RTC credential file requires an absolute path');
  requireValue(Number.isSafeInteger(uid), 'RTC credential file requires a POSIX user id');
  return async () => {
    let handle;
    try {
      handle = await fs.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      const stat = await handle.stat();
      requireValue(stat.isFile() && stat.uid === uid && (stat.mode & 0o7777) === 0o600,
        'RTC credential file must be regular, owner-owned and mode 0600');
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (!chunk.bytesRead) break;
        bytesRead += chunk.bytesRead;
      }
      requireValue(bytesRead > 0 && bytesRead <= MAX_BYTES, 'RTC credential file size is invalid');
      let payload;
      try { payload = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')); }
      catch { throw new Error('RTC credential file contains invalid JSON'); }
      requireValue(payload?.schema === 'reploid.pool.turn_credentials/v1', 'RTC credential schema is invalid');
      requireValue(Date.parse(payload.expiresAt) > now() + 60000, 'RTC credentials expire too soon');
      const config = payload.rtcConfig;
      requireValue(config && ['all', 'relay'].includes(config.iceTransportPolicy), 'RTC transport policy is invalid');
      requireValue(Array.isArray(config.iceServers) && config.iceServers.length > 0 && config.iceServers.length <= 8,
        'RTC servers are invalid');
      let relay = false;
      const iceServers = config.iceServers.map(server => {
        const urls = typeof server?.urls === 'string' ? [server.urls] : server?.urls;
        requireValue(Array.isArray(urls) && urls.length > 0 && urls.length <= 16 && urls.every(url =>
          typeof url === 'string' && url.length <= 2048 && /^(stun|stuns|turn|turns):[^\s]+$/.test(url)), 'RTC URLs are invalid');
        if (!urls.some(url => /^turns?:/.test(url))) return { urls };
        requireValue(typeof server.username === 'string' && server.username.length > 0 && server.username.length <= 2048
          && typeof server.credential === 'string' && server.credential.length > 0 && server.credential.length <= 2048,
        'RTC relay credentials are invalid');
        relay = true;
        return { urls, username: server.username, credential: server.credential, credentialType: 'password' };
      });
      requireValue(relay, 'RTC credential file requires a TURN relay');
      return { iceTransportPolicy: config.iceTransportPolicy, iceServers };
    } catch (error) {
      if (error.code) throw new Error('RTC credential file is unavailable');
      throw error;
    } finally { await handle?.close(); }
  };
}
