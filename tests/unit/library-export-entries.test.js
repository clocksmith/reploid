// @vitest-environment node
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = pathToFileURL(path.resolve('packages/reploid') + path.sep);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const entries = Object.entries(pkg.exports).map(([name, entry]) =>
  [name, typeof entry === 'string' ? { import: entry } : entry]);

describe('packages/reploid public entries', () => {
  it.each(entries)('%s loads in Node and its declared files exist', async (name, entry) => {
    for (const file of Object.values(entry)) expect(existsSync(new URL(file, root)), file).toBe(true);
    const target = new URL(entry.import, root);
    if (entry.import.endsWith('.json')) {
      expect(JSON.parse(readFileSync(target, 'utf8'))).toBeTypeOf('object');
      return;
    }
    expect(Object.keys(await import(target.href)).length).toBeGreaterThan(0);
  });
});
