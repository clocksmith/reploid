// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeGeneratedRegistry } from '../../scripts/generated-registry-output.js';

describe('generated registry output', () => {
  it('preserves unchanged bytes and dates, updates content, and preserves invalid input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'registry-output-test-'));
    const file = join(directory, 'registry.json');
    try {
      const content = { version: 1, modules: { Example: { files: ['example.js'] } } };
      expect(await writeGeneratedRegistry(file, content)).toBe(true);
      const first = await readFile(file, 'utf8');
      expect(await writeGeneratedRegistry(file, content)).toBe(false);
      expect(await readFile(file, 'utf8')).toBe(first);
      expect(await writeGeneratedRegistry(file, { ...content, modules: {} })).toBe(true);
      expect(JSON.parse(await readFile(file, 'utf8')).modules).toEqual({});
      await writeFile(file, 'invalid existing registry');
      await expect(writeGeneratedRegistry(file, content)).rejects.toThrow();
      expect(await readFile(file, 'utf8')).toBe('invalid existing registry');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
