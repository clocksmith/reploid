// Exact filesystem code provenance. This never imports peer/provider model code.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
const inside = (root, target) => target === root || !path.relative(root, target).startsWith('..' + path.sep)
  && path.relative(root, target) !== '..' && !path.isAbsolute(path.relative(root, target));

export async function inspectPeerRuntime({ roots, maxBytes, timeoutMs, signal }) {
  assert(Array.isArray(roots) && roots.length > 0 && roots.every(root => typeof root.label === 'string'
    && /^[a-z0-9-]+$/u.test(root.label) && typeof root.path === 'string' && path.isAbsolute(root.path))
    && new Set(roots.map(root => root.label)).size === roots.length, 'Explicit unique code roots required');
  assert(Number.isSafeInteger(maxBytes) && maxBytes > 0 && Number.isSafeInteger(timeoutMs) && timeoutMs > 0,
    'Peer provenance requires explicit byte/time limits');
  const active = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  assert(Number.isInteger(constants.O_NOFOLLOW) && Number.isInteger(constants.O_NONBLOCK),
    'Peer provenance requires no-follow nonblocking descriptor admission');
  const selected = structuredClone(roots), files = [], checks = [], buffer = new Uint8Array(64 * 1024);
  let total = 0;
  for (const entry of selected) {
    active.throwIfAborted();
    const root = await fs.realpath(entry.path);
    checks.push(async () => assert.equal(await fs.realpath(entry.path), root, 'Peer code root changed during inventory'));
    async function walk(relative) {
      active.throwIfAborted();
      const filename = relative ? path.join(root, relative) : root;
      const before = await fs.lstat(filename, { bigint: true });
      checks.push(async () => assert.equal(stamp(await fs.lstat(filename, { bigint: true })), stamp(before),
        'Peer code changed during inventory'));
      if (before.isSymbolicLink()) {
        const link = await fs.readlink(filename), target = await fs.realpath(filename);
        assert(inside(root, target), 'Peer dependency link escapes its explicit code root');
        assert(!path.relative(root, target).split(path.sep).includes('.git'), 'Peer dependency link enters excluded code');
        checks.push(async () => {
          assert.equal(await fs.readlink(filename), link, 'Peer code link changed during inventory');
          assert.equal(await fs.realpath(filename), target, 'Peer code link target changed during inventory');
        });
        files.push({ path: entry.label + '/' + relative, link, sizeBytes: 0, sha256: hash(link) });
        return;
      }
      if (before.isDirectory()) {
        const names = (await fs.readdir(filename)).sort();
        // Directory times and size may stay unchanged across a namespace update.
        checks.push(async () => assert.deepEqual((await fs.readdir(filename)).sort(), names,
          'Peer code directory changed during inventory'));
        for (const name of names) {
          assert(!/[\x00-\x1f\x7f\\]/u.test(name), 'Unsupported peer source filename');
          if (name === '.git') continue;
          await walk(relative ? relative + '/' + name : name);
        }
        return;
      }
      assert(before.isFile() && before.size <= BigInt(Number.MAX_SAFE_INTEGER), 'Peer code must contain regular finite files');
      const size = Number(before.size);
      total += size;
      assert(total <= maxBytes, 'Peer code inventory exceeds its explicit read budget');
      const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        assert(stamp(await handle.stat({ bigint: true })) === stamp(before), 'Peer code changed at descriptor admission');
        const digest = createHash('sha256');
        let offset = 0;
        while (offset < size) {
          active.throwIfAborted();
          const result = await handle.read(buffer, 0, Math.min(buffer.length, size - offset), offset);
          assert(result.bytesRead > 0, 'Truncated peer code');
          digest.update(buffer.subarray(0, result.bytesRead)); offset += result.bytesRead;
        }
        assert(stamp(await handle.stat({ bigint: true })) === stamp(before)
          && stamp(await fs.lstat(filename, { bigint: true })) === stamp(before), 'Peer code changed during inventory');
        files.push({ path: entry.label + (relative ? '/' + relative : ''), sizeBytes: size, sha256: digest.digest('hex') });
      } finally { await handle.close(); }
    }
    await walk('');
  }
  // Recheck the whole observed namespace after the last read: directory inserts,
  // ancestor swaps and changes to earlier files must not yield a mixed snapshot.
  for (const check of checks) { active.throwIfAborted(); await check(); }
  active.throwIfAborted();
  files.sort((a, b) => {
    if (a.path === b.path) return 0;
    return a.path < b.path ? -1 : 1;
  });
  return { schema: 'reploid.peer-runtime-identity/v1', treeSha256: hash(JSON.stringify(files)), fileCount: files.length,
    codeBytes: total, roots: selected, files, scope: 'Exact selected filesystem code bytes, including dependencies and native binaries; no runtime import, model, driver or hardware qualification' };
}

export async function verifyPeerRuntime(config) {
  const expectedBytes = await fs.readFile(config.inventory.path);
  assert.equal(hash(expectedBytes), config.inventory.sha256, 'Peer provenance receipt identity mismatch');
  const expected = JSON.parse(expectedBytes);
  const observed = await inspectPeerRuntime(config);
  assert.equal(observed.treeSha256, expected.treeSha256, 'Peer runtime code changed after freeze');
  assert.equal(observed.fileCount, expected.fileCount);
  return { ...observed, files: undefined };
}
