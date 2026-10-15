/**
 * @fileoverview Bounded server-side page fetch for cited search results. Only http(s) to public addresses:
 * every hop's addresses are checked inside the socket's own DNS lookup, so a rebinding answer cannot reach a
 * private network, and IP-literal hosts are checked before connecting. Redirects are followed manually and
 * re-checked. Content type is checked before the body is read; raw and decompressed bytes are capped.
 * PDF is declared unsupported rather than extracted.
 */
import crypto from 'node:crypto';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { PageFetchError } from './errors.js';

export const DEFAULT_ALLOWED_TYPES = Object.freeze(['text/html', 'application/xhtml+xml', 'text/plain']);
const BLOCKED_LOOKUP = 'EREPLOIDBLOCKEDADDRESS';

const IPV4_BLOCKS = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]].map(([base, bits]) => [ipv4Number(base), bits]);

function ipv4Number(address) {
  return address.split('.').reduce((value, part) => value * 256 + Number(part), 0);
}
function blockedIpv4(address) {
  const value = ipv4Number(address);
  return IPV4_BLOCKS.some(([base, bits]) => Math.floor(value / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)));
}

/** Eight 16-bit groups, with an embedded dotted IPv4 tail expanded. */
function ipv6Groups(address) {
  let text = address.toLowerCase().split('%')[0];
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const value = ipv4Number(dotted[1]);
    text = text.slice(0, -dotted[1].length) + `${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const left = head ? head.split(':') : [], right = tail ? tail.split(':') : [];
  const groups = text.includes('::') ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right] : left;
  return groups.map(group => parseInt(group, 16));
}

/** True for loopback, private, link-local, shared, multicast, reserved and documentation addresses. */
export function isBlockedAddress(address) {
  const family = net.isIP(String(address || '').split('%')[0]);
  if (family === 4) return blockedIpv4(address);
  if (family !== 6) return true;
  const groups = ipv6Groups(address);
  if (groups.length !== 8 || groups.some(group => !Number.isInteger(group))) return true;
  const embedded = () => `${groups[6] >> 8}.${groups[6] & 255}.${groups[7] >> 8}.${groups[7] & 255}`;
  if (groups.slice(0, 7).every(group => group === 0) && groups[7] <= 1) return true; // :: and ::1
  if (groups.slice(0, 5).every(group => group === 0) && (groups[5] === 0xffff || groups[5] === 0)) return blockedIpv4(embedded()); // IPv4-mapped/compatible
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every(group => group === 0)) return blockedIpv4(embedded()); // NAT64
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((groups[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true; // documentation
  if (groups[0] === 0x0100 && groups.slice(1, 4).every(group => group === 0)) return true; // discard-only
  return false;
}

/** A dns.lookup-compatible function that refuses blocked answers, for the socket to use itself. */
export function guardedLookup(base = dns.lookup, isBlocked = isBlockedAddress) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    const settings = typeof options === 'number' ? { family: options } : options || {};
    base(hostname, { ...settings, all: true }, (error, addresses) => {
      if (error) { callback(error); return; }
      const rows = (Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }]).filter(row => row?.address);
      if (!rows.length || rows.some(row => isBlocked(row.address))) {
        callback(Object.assign(new Error(`${hostname} resolves to a blocked address`), { code: BLOCKED_LOOKUP })); return;
      }
      if (settings.all) callback(null, rows);
      else callback(null, rows[0].address, rows[0].family || net.isIP(rows[0].address));
    });
  };
}

const mimeOf = value => String(value || '').split(';')[0].trim().toLowerCase();
const charsetOf = value => String(value || '').match(/charset\s*=\s*["']?([\w.:-]+)/i)?.[1] || null;

function decoder(encoding) {
  const name = String(encoding || '').trim().toLowerCase();
  if (!name || name === 'identity') return null;
  if (name === 'gzip' || name === 'x-gzip') return zlib.createGunzip();
  if (name === 'deflate') return zlib.createInflate();
  if (name === 'br') return zlib.createBrotliDecompress();
  throw new PageFetchError('fetch-failed', { detail: `Unsupported content encoding ${name}` });
}

export function createPageFetcher({ maxBytes = 2_000_000, timeoutMs = 8000, maxRedirects = 3, allowedTypes = DEFAULT_ALLOWED_TYPES,
  lookup = dns.lookup, allowPrivateAddresses = false, isBlocked = isBlockedAddress,
  userAgent = 'ReploidSourceFetcher/1 (+https://github.com/clocksmith/reploid)' } = {}) {
  // allowPrivateAddresses is for tests and local development only.
  const blocked = allowPrivateAddresses ? () => false : isBlocked, resolve = guardedLookup(lookup, blocked);
  const allowed = new Set(allowedTypes.map(type => type.toLowerCase()));

  function target(value) {
    let url;
    try { url = new URL(value); } catch { throw new PageFetchError('invalid-url'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) throw new PageFetchError('invalid-url');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && blocked(host)) throw new PageFetchError('blocked-address', { detail: host });
    return url;
  }

  /** One request; resolves { response } with the body unread. */
  function request(url, signal) {
    return new Promise((done, fail) => {
      const client = url.protocol === 'https:' ? https : http;
      const outgoing = client.request(url, { method: 'GET', lookup: resolve, signal, agent: false,
        headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9', 'Accept-Encoding': 'gzip, deflate, br' } });
      outgoing.on('response', response => done(response));
      outgoing.on('error', error => fail(error));
      outgoing.end();
    });
  }

  function readBody(response, signal) {
    return new Promise((done, fail) => {
      const declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) { response.destroy(); fail(new PageFetchError('too-large', { detail: `${declared} bytes` })); return; }
      let stream = response, raw = 0, size = 0;
      const chunks = [];
      const stop = error => { response.destroy(); stream.destroy?.(); fail(error); };
      try { const decode = decoder(response.headers['content-encoding']); if (decode) stream = response.pipe(decode); }
      catch (error) { stop(error); return; }
      response.on('data', chunk => { raw += chunk.length; if (raw > maxBytes) stop(new PageFetchError('too-large', { detail: 'Transfer exceeds the byte limit' })); });
      stream.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { stop(new PageFetchError('too-large', { detail: 'Decoded body exceeds the byte limit' })); return; }
        chunks.push(chunk);
      });
      stream.on('end', () => done(Buffer.concat(chunks)));
      stream.on('error', error => fail(signal.aborted ? signal.reason : new PageFetchError('fetch-failed', { detail: error.code || 'decode error' })));
      response.on('error', error => fail(signal.aborted ? signal.reason : new PageFetchError('fetch-failed', { detail: error.code || 'read error' })));
      // A connection that closes before the body ends (including on timeout) settles as a failure.
      stream.on('close', () => { if (!stream.readableEnded) fail(signal.aborted ? signal.reason : new PageFetchError('fetch-failed', { detail: 'connection closed' })); });
    });
  }

  async function fetchPage(value, { signal = null } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new PageFetchError('timeout', { detail: `${timeoutMs} ms` })), timeoutMs);
    const forward = () => controller.abort(new PageFetchError('cancelled'));
    if (signal?.aborted) forward(); else signal?.addEventListener('abort', forward, { once: true });
    try {
      let url = target(value);
      for (let hop = 0; ; hop++) {
        let response;
        try { response = await request(url, controller.signal); }
        catch (error) {
          if (controller.signal.aborted) throw controller.signal.reason;
          if (error.code === BLOCKED_LOOKUP) throw new PageFetchError('blocked-address', { detail: url.hostname });
          throw new PageFetchError('fetch-failed', { detail: error.code || error.message });
        }
        const status = response.statusCode;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          if (hop >= maxRedirects) throw new PageFetchError('too-many-redirects', { status });
          url = target(new URL(response.headers.location, url).href);
          continue;
        }
        if (status < 200 || status >= 300) { response.resume(); throw new PageFetchError('http-error', { status }); }
        const contentType = String(response.headers['content-type'] || ''), mime = mimeOf(contentType);
        if (mime === 'application/pdf') { response.destroy(); throw new PageFetchError('unsupported-content-type', { status, detail: 'PDF text extraction is not supported' }); }
        if (!allowed.has(mime)) { response.destroy(); throw new PageFetchError('unsupported-content-type', { status, detail: mime ? `${mime} is not supported` : 'The page has no content type' }); }
        let body;
        try { body = await readBody(response, controller.signal); }
        catch (error) { if (controller.signal.aborted) throw controller.signal.reason; throw error; }
        return { url: url.href, status, contentType, charset: charsetOf(contentType), bytes: body.length,
          byteSha256: 'sha256:' + crypto.createHash('sha256').update(body).digest('hex'), body };
      }
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', forward);
    }
  }
  return Object.freeze({ fetchPage, maxBytes, timeoutMs });
}
