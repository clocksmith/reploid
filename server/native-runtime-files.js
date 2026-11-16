// Byte inventory shared by explicit native source selection and offline diagnostics.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateRelativePath(value) {
  assert(typeof value === 'string' && value.length > 0, 'Empty package path');
  assert(!/[\\\x00-\x1f\x7f]/u.test(value), `Unsupported package path: ${value}`);
  assert(!value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..'),
    `Unsafe package path: ${value}`);
}

export async function inventory(directory, { installed = false, source = false } = {}) {
  const files = [];
  const root = source ? await fs.realpath(directory) : null;
  async function walk(relative) {
    const absolute = path.join(directory, relative);
    const stat = await fs.lstat(absolute);
    if (source && relative && stat.isSymbolicLink()) {
      const target = await fs.realpath(absolute);
      const targetPath = path.relative(root, target);
      assert(targetPath && !targetPath.startsWith('..' + path.sep) && targetPath !== '..' && !path.isAbsolute(targetPath),
        `Source link escapes checkout: ${relative}`);
      assert(!['.git', 'node_modules'].includes(targetPath.split(path.sep)[0]), `Source link targets excluded bytes: ${relative}`);
      const link = await fs.readlink(absolute);
      files.push({ path: relative, sizeBytes: 0, sha256: sha(link), link });
      return;
    }
    assert(!stat.isSymbolicLink(), `Package links are not supported: ${relative || '.'}`);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(absolute)).sort()) {
        const child = relative ? relative + '/' + name : name;
        validateRelativePath(child);
        // Non-bundled dependencies have a separate lockfile/provider identity.
        // Never imply this package receipt verifies their bytes.
        if (source && child === '.git') continue;
        if (child === 'node_modules') {
          assert(installed, 'Bundled dependencies require a separate archive contract');
          continue;
        }
        await walk(child);
      }
    } else {
      assert(stat.isFile(), `Unsupported package entry: ${relative}`);
      const bytes = await fs.readFile(absolute);
      files.push({ path: relative, sizeBytes: bytes.length, sha256: sha(bytes) });
    }
  }
  await walk('');
  files.sort((a, b) => {
    if (a.path === b.path) return 0;
    return a.path < b.path ? -1 : 1;
  });
  return files;
}
