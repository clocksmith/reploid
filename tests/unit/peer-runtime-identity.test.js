// @vitest-environment node
import { it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectPeerRuntime, verifyPeerRuntime } from '../fixtures/peers/pooled/runtime-identity.js';
import { createHash } from 'node:crypto';

it('pins the full selected dependency tree, internal aliases and native binary bytes without importing it', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-code-'));
  try {
    const dependencies = path.join(root, 'modules'); await fs.mkdir(dependencies);
    await fs.writeFile(path.join(dependencies, 'entry.js'), 'throw new Error("must not import")');
    await fs.writeFile(path.join(dependencies, 'provider.node'), Uint8Array.of(1, 2, 3));
    await fs.symlink('entry.js', path.join(dependencies, 'alias'));
    const config = { roots: [{ label: 'dependencies', path: dependencies }], maxBytes: 1024, timeoutMs: 1000 };
    const receipt = await inspectPeerRuntime(config);
    expect(receipt.fileCount).toBe(3);
    const bytes = JSON.stringify(receipt), receiptPath = path.join(root, 'identity.json');
    await fs.writeFile(receiptPath, bytes);
    const pinned = { ...config, inventory: { path: receiptPath, sha256: createHash('sha256').update(bytes).digest('hex') } };
    expect((await verifyPeerRuntime(pinned)).treeSha256).toBe(receipt.treeSha256);
    await fs.writeFile(path.join(dependencies, 'provider.node'), Uint8Array.of(1, 2, 4));
    await expect(verifyPeerRuntime(pinned)).rejects.toThrow('code changed');
    await expect(inspectPeerRuntime({ ...config, maxBytes: 1 })).rejects.toThrow('read budget');
    await fs.symlink(root, path.join(dependencies, 'escape'));
    await expect(inspectPeerRuntime(config)).rejects.toThrow('escapes');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('settles descriptor ownership on cancellation during a real read', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-code-cancel-'));
  const original = fs.open.bind(fs), control = new AbortController();
  let handle, close;
  try {
    await fs.writeFile(path.join(root, 'entry.js'), new Uint8Array(128 * 1024));
    vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
      handle = await original(...args); const read = handle.read.bind(handle);
      close = vi.spyOn(handle, 'close');
      vi.spyOn(handle, 'read').mockImplementation(async (...values) => {
        const result = await read(...values); control.abort(new Error('cancel inventory')); return result;
      });
      return handle;
    });
    await expect(inspectPeerRuntime({ roots: [{ label: 'code', path: root }], maxBytes: 1024 * 1024,
      timeoutMs: 1000, signal: control.signal })).rejects.toThrow('cancel inventory');
    expect(close).toHaveBeenCalledOnce();
  } finally { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); }
});

it('rejects aliases into excluded code and namespace mutation during inventory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-code-swap-'));
  const original = fs.open.bind(fs);
  try {
    await fs.mkdir(path.join(root, '.git'));
    await fs.writeFile(path.join(root, '.git/payload.js'), 'untracked executable');
    await fs.symlink('.git/payload.js', path.join(root, 'alias.js'));
    const config = { roots: [{ label: 'code', path: root }], maxBytes: 1024, timeoutMs: 1000 };
    await expect(inspectPeerRuntime(config)).rejects.toThrow('excluded code');
    await fs.unlink(path.join(root, 'alias.js'));
    await fs.writeFile(path.join(root, 'entry.js'), 'entry');
    vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
      const handle = await original(...args);
      await fs.writeFile(path.join(root, 'inserted.js'), 'new executable');
      return handle;
    });
    await expect(inspectPeerRuntime(config)).rejects.toThrow('changed during inventory');
  } finally { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); }
});
