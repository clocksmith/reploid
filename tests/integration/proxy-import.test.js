// @vitest-environment node
import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

it('imports the proxy without listening, logging, changing environment or installing process handlers', async () => {
  const code = `
    const signals = ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection'];
    const before = signals.map(name => process.listenerCount(name));
    const env = JSON.stringify(process.env);
    const proxy = await import('./server/proxy.js');
    if (JSON.stringify(before) !== JSON.stringify(signals.map(name => process.listenerCount(name)))) throw Error('process handlers changed');
    if (env !== JSON.stringify(process.env)) throw Error('environment changed');
    if (typeof proxy.createProxy !== 'function' || typeof proxy.startProxy !== 'function') throw Error('missing factory');
    console.log('inert');
  `;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], {
    cwd: new URL('../../', import.meta.url), timeout: 8000
  });
  expect(result.stdout.trim()).toBe('inert');
  expect(result.stderr).toBe('');
});
