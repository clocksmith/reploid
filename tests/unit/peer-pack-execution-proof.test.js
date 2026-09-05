// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProofSourceSnapshot, readRuntimeBootstrapShaders } from '../../scripts/verify-peer-pack-execution.js';
import { sha256Hex } from '../../self/pool/inference-receipt.js';

describe('peer Pack proof runtime bootstrap boundary', () => {
  it('retains exact runtime bytes and freezes repeat requests across peers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peer-pack-source-test-'));
    try {
      const file = join(root, 'runtime.js');
      await writeFile(file, 'first source');
      const snapshot = createProofSourceSnapshot();
      const first = await snapshot.read('/runtime.js', file);
      first.fill(0);
      await writeFile(file, 'changed source');
      const repeat = await snapshot.read('/runtime.js', file);
      expect(new TextDecoder().decode(repeat)).toBe('first source');
      expect(await snapshot.receipts()).toEqual([{ path: '/runtime.js', hash: await sha256Hex(repeat), sizeBytes: repeat.length }]);
      await expect(snapshot.read('/missing.js', join(root, 'missing.js'))).rejects.toThrow('ENOENT');
      expect((await snapshot.receipts())[0]).toMatchObject({ path: '/missing.js', error: expect.stringContaining('ENOENT') });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('allows only pinned device probes, never model shaders', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peer-pack-runtime-test-'));
    try {
      await mkdir(join(root, 'src/config/kernels'), { recursive: true });
      await mkdir(join(root, 'src/gpu/kernels'), { recursive: true });
      await writeFile(join(root, 'src/config/kernels/registry.json'), JSON.stringify({ operations: {
        runtime_probe: { variants: { submit: { wgsl: 'submit_probe.wgsl' } } },
        model_operation: { variants: { main: { wgsl: 'model.wgsl' } } },
      } }));
      const bytes = new TextEncoder().encode('fixture device probe, not execution evidence');
      await writeFile(join(root, 'src/gpu/kernels/submit_probe.wgsl'), bytes);
      const declaration = { file: 'submit_probe.wgsl', hash: await sha256Hex(bytes) };
      const result = await readRuntimeBootstrapShaders(root, [declaration]);
      expect(result.receipts[0]).toEqual({ ...declaration, sizeBytes: bytes.length, owner: 'doppler-runtime-device-probe' });
      expect(result.sources['submit_probe.wgsl']).toContain('fixture');
      await expect(readRuntimeBootstrapShaders(root)).rejects.toThrow('explicit');
      await expect(readRuntimeBootstrapShaders(root, [declaration, declaration])).rejects.toThrow('unique runtime device probes');
      await expect(readRuntimeBootstrapShaders(root, [{ ...declaration, hash: 'sha256:' + '0'.repeat(64) }])).rejects.toThrow('digest mismatch');
      for (const file of ['model.wgsl', '../submit_probe.wgsl', '/submit_probe.wgsl']) {
        await expect(readRuntimeBootstrapShaders(root, [{ ...declaration, file }])).rejects.toThrow('runtime device probes');
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
