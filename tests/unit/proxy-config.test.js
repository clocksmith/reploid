// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProxyConfig } from '../../server/proxy-config.js';

it('allows an absent default, but refuses missing explicit paths and malformed files', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'reploid-config-'));
  try {
    expect(await loadProxyConfig({ cwd, env: {} })).toEqual({ config: {}, path: null });
    await expect(loadProxyConfig({ cwd, env: { REPLOID_CONFIG_PATH: 'missing.json' } })).rejects.toThrow('Cannot read');
    await writeFile(join(cwd, '.reploidrc.json'), '{bad');
    await expect(loadProxyConfig({ cwd, env: {} })).rejects.toThrow('Invalid JSON');
    for (const config of [[], { server: { port: -1 } }, { ollama: { autoStart: 'false' } }, { api: { openaiKey: 1 } }]) {
      await writeFile(join(cwd, '.reploidrc.json'), JSON.stringify(config));
      await expect(loadProxyConfig({ cwd, env: {} })).rejects.toThrow();
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

it('loads the requested file, expands environment references and preserves explicit false and zero', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'reploid-config-'));
  try {
    await writeFile(join(cwd, 'owned.json'), JSON.stringify({ api: { openaiKey: '${TEST_KEY}' },
      server: { port: 0 }, ollama: { autoStart: false } }));
    const result = await loadProxyConfig({ cwd, env: { REPLOID_CONFIG_PATH: 'owned.json', TEST_KEY: 'secret' } });
    expect(result.config).toMatchObject({ api: { openaiKey: 'secret' }, server: { port: 0 }, ollama: { autoStart: false } });
    await expect(loadProxyConfig({ cwd, env: { REPLOID_CONFIG_PATH: 'owned.json' } })).rejects.toThrow('TEST_KEY');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
