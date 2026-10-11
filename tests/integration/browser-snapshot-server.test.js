// @vitest-environment node
import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';

it('serves every browser entry and asset from the selected snapshot without checkout fallback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reploid-static-root-test-'));
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(done => reservation.close(done));
  const files = {
    'pool-entry.html': 'snapshot conversation',
    'change-passport-entry.html': 'snapshot passport',
    'index.html': 'snapshot substrate',
    'design.html': 'snapshot design',
    'audit.html': 'snapshot audit',
    'reset.html': 'snapshot reset',
    'pool/browser-release-identity.js': 'snapshot pool asset',
    'config/browser-bundle-manifest.json': '{"snapshot":true}',
    'vendor/runtime.wgsl': 'snapshot shader'
  };
  let child;
  try {
    for (const [name, bytes] of Object.entries(files)) {
      await mkdir(join(directory, name, '..'), { recursive: true });
      await writeFile(join(directory, name), bytes);
    }
    child = spawn(process.execPath, ['server/proxy.js'], {
      cwd: resolve(import.meta.dirname, '../..'),
      env: { ...process.env, PORT: String(port), REPLOID_STATIC_ROOT: directory,
        REPLOID_SKIP_CLOUD_ACCESS_BUILD: 'true', DECO_VISUAL_FEEDBACK: '0', AUTO_START_OLLAMA: 'false' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((done, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Snapshot server startup failed: ${output}`)), 15000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Snapshot server exited ${code}: ${output}`)); });
      const inspect = bytes => {
        output = (output + bytes).slice(-16000);
        if (output.includes(`HTTP API: http://localhost:${port}`)) { clearTimeout(timer); done(); }
      };
      child.stdout.on('data', inspect); child.stderr.on('data', inspect);
    });
    const routes = { '/': 'pool-entry.html', '/work': 'pool-entry.html', '/passports': 'change-passport-entry.html',
      '/zero': 'index.html', '/x': 'index.html', '/design': 'design.html', '/audit': 'audit.html', '/reset': 'reset.html' };
    for (const name of Object.keys(files)) routes['/' + name] = name;
    for (const [route, name] of Object.entries(routes)) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`);
      expect(response.status, route).toBe(200);
      expect(await response.text(), route).toBe(files[name]);
    }
    // These exist in the checkout, but must not leak into an incomplete snapshot.
    for (const [route, status] of [['/config/work-profile.json', 404], ['/pool/pool-config.json', 401]]) {
      // The /pool service requires authorization after its static-file miss.
      expect((await fetch(`http://127.0.0.1:${port}${route}`)).status).toBe(status);
    }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 2000);
      await exited; clearTimeout(force);
    }
    await rm(directory, { recursive: true, force: true });
  }
}, 25000);
