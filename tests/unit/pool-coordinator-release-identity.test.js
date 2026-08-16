import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildCoordinatorRuntimeBundle,
  validateCoordinatorRuntimeBundle
} from '../../server/pool/release-identity.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

describe('Poolday coordinator runtime release identity', () => {
  it('is deterministic and changes on a same-size executed-source mutation', async () => {
    const rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-runtime-bundle-'));
    temporaryDirectories.push(rootDirectory);
    await fs.mkdir(path.join(rootDirectory, 'server'));
    await fs.writeFile(path.join(rootDirectory, 'server', 'proxy.js'), 'export const version = 1;\n');
    await fs.writeFile(path.join(rootDirectory, 'package.json'), '{"type":"module"}\n');
    const options = { rootDirectory, scope: ['server', 'package.json'] };

    const baseline = await buildCoordinatorRuntimeBundle(options);
    const repeated = await buildCoordinatorRuntimeBundle({ ...options, scope: [...options.scope].reverse() });
    expect(repeated).toEqual(baseline);
    expect(validateCoordinatorRuntimeBundle(baseline)).toEqual({ ok: true, reasons: [] });

    await fs.writeFile(path.join(rootDirectory, 'server', 'proxy.js'), 'export const version = 2;\n');
    const mutated = await buildCoordinatorRuntimeBundle(options);
    expect(mutated.files[1].byteLength).toBe(baseline.files[1].byteLength);
    expect(mutated.files[1].sha256).not.toBe(baseline.files[1].sha256);
    expect(mutated.runtimeBundleHash).not.toBe(baseline.runtimeBundleHash);
  });

  it('rejects a stale or reordered manifest', async () => {
    const rootDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-runtime-bundle-'));
    temporaryDirectories.push(rootDirectory);
    await fs.mkdir(path.join(rootDirectory, 'server'));
    await fs.writeFile(path.join(rootDirectory, 'server', 'a.js'), 'a');
    await fs.writeFile(path.join(rootDirectory, 'server', 'b.js'), 'b');
    const bundle = await buildCoordinatorRuntimeBundle({ rootDirectory, scope: ['server'] });
    const reordered = { ...bundle, files: [...bundle.files].reverse() };
    expect(validateCoordinatorRuntimeBundle(reordered)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        'coordinator runtime bundle path is not unique and sorted: server/a.js',
        'coordinator runtime bundle hash is invalid'
      ])
    });
  });
});
