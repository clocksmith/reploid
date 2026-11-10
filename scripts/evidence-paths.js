/**
 * Evidence retained in this public repository names files portably: a path inside
 * the checkout is written repo-relative, and anything under a home directory as
 * `~/...`. Reports, receipts and captured logs never carry a machine's absolute
 * home path: not the current user's, and not another machine's home that reached
 * the output through a peer, a log or a copied manifest.
 */
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

export const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..');

const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// One separator as written in a plain Windows path, a forward-slash path or JSON-escaped text.
const SEPARATOR = String.raw`(?:\\\\|\\|/)`;
const USER = String.raw`(?!Shared(?:[\\/]|$))[A-Za-z0-9_-](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?`;
const END = String.raw`(?![A-Za-z0-9_-]|\.[A-Za-z0-9_])`;
// Any user's home prefix: /home/<user> and /Users/<user> (also reached through ../ chains
// or written with escaped slashes) and <drive>:\Users\<user> in plain, forward-slash or
// JSON-escaped form.
const ANY_HOME = new RegExp([
  String.raw`(?:\.\./)+(?:home|Users)/${USER}(?=/)`,
  String.raw`\\/(?:home|Users)\\/${USER}(?=\\/)`,
  String.raw`/(?:home|Users)/${USER}${END}`,
  String.raw`[A-Za-z]:${SEPARATOR}[Uu][Ss][Ee][Rr][Ss]${SEPARATOR}${USER}${END}`
].join('|'), 'g');
const WORD = /[A-Za-z0-9_.~-]/;
const COLOR_CODE_TAIL = new RegExp(String.raw`\u001b\[[0-9;]*m$`);

// A /home or /Users match glued to a word is a URL path or an identifier, not a home
// prefix; terminal color codes before a path do not count as a word.
const gluedToWord = (text, offset, match) => match[0] === '/' && offset > 0 && WORD.test(text[offset - 1])
  && !COLOR_CODE_TAIL.test(text.slice(Math.max(0, offset - 16), offset));

function currentHomePattern(home) {
  if (typeof home !== 'string' || !home) return null;
  if (/^[A-Za-z]:[\\/]/.test(home)) {
    const parts = home.split(/[\\/]+/).filter(Boolean);
    return parts.length < 2 ? null : new RegExp(parts.map(escapePattern).join(SEPARATOR) + END, 'gi');
  }
  if (!path.posix.isAbsolute(home)) return null;
  const normalized = path.posix.resolve(home);
  return normalized === '/' ? null : new RegExp(escapePattern(normalized) + END, 'g');
}

/** Text with the current user's home and every other home-directory prefix replaced by `~`. */
export function redactHomeText(text, { home = os.homedir() } = {}) {
  const current = currentHomePattern(home);
  const own = current ? String(text).replace(current, '~') : String(text);
  return own.replace(ANY_HOME, (match, offset, whole) => (gluedToWord(whole, offset, match) ? match : '~'));
}

/** One path for a report: repo-relative inside the checkout, `~/...` under home, otherwise unchanged. */
export function portablePath(value, { root = REPOSITORY_ROOT, home = os.homedir() } = {}) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return value;
  const relative = path.relative(root, value);
  if (relative === '') return '.';
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  return redactHomeText(value, { home });
}

/** A path read back from evidence: `~/...` resolves under the home directory again. */
export function expandHomePath(value, { home = os.homedir() } = {}) {
  if (typeof value !== 'string' || !(value === '~' || value.startsWith('~/'))) return value;
  return path.join(home, value.slice(2));
}

/** Deep copy of a report value with the home prefix removed from every string and key. */
export function portableEvidence(value, options = {}) {
  if (typeof value === 'string') return redactHomeText(value, options);
  if (Array.isArray(value)) return value.map(item => portableEvidence(item, options));
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [redactHomeText(key, options), portableEvidence(item, options)]));
  }
  return value;
}

/** Line-buffered stream that redacts captured process output before it reaches a log. */
export function homeRedactingStream(options = {}) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  return new Transform({
    transform(chunk, _encoding, done) {
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      const end = pending.lastIndexOf('\n');
      if (end >= 0) {
        this.push(redactHomeText(pending.slice(0, end + 1), options));
        pending = pending.slice(end + 1);
      }
      done();
    },
    flush(done) {
      pending += decoder.end();
      if (pending) this.push(redactHomeText(pending, options));
      pending = '';
      done();
    }
  });
}
