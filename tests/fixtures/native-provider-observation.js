import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
/** Bind file-backed libraries and separately retain the kernel's virtual DSO. */
export async function observeNativeProviderLibraries(sharedObjects, read = readFile) {
  const libraries = [], virtualLibraries = [];
  for (const path of sharedObjects) {
    if (path === 'linux-vdso.so.1') {
      virtualLibraries.push({ name: path, kind: 'kernel-virtual-dso', fileHashAvailable: false });
      continue;
    }
    assert(isAbsolute(path), 'Unresolved native library path');
    const bytes = await read(path);
    libraries.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  assert(libraries.some(row => row.path.endsWith('.node') && row.path.includes('webgpu')),
    'The selected native WebGPU library was not observed in this process');
  return { libraries, virtualLibraries };
}
