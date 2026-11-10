/**
 * Evidence retained in this public repository names files portably: a path inside
 * the checkout is written repo-relative, and anything under the home directory as
 * `~/...`. Reports, receipts and captured logs never carry a machine's absolute
 * home path.
 */
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

export const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..');

const escapePattern = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function homePattern(home) {
  if (typeof home !== 'string' || !path.isAbsolute(home)) return null;
  const normalized = path.resolve(home);
  if (normalized === path.parse(normalized).root) return null;
  return new RegExp(`${escapePattern(normalized)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9_])`, 'g');
}

/** Text with every home-directory prefix replaced by `~` (file URLs included). */
export function redactHomeText(text, { home = os.homedir() } = {}) {
  const pattern = homePattern(home);
  return pattern ? String(text).replace(pattern, '~') : String(text);
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
