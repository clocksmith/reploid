#!/usr/bin/env node
// Installed-package boundary checks, not model or intelligence qualification.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import dopplerFixture from './library-doppler-fixture.json' with { type: 'json' };

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.join(root, 'artifacts/library-acceptance', new Date().toISOString().replace(/[:.]/g, '-'));
const consumer = await mkdtemp(path.join(tmpdir(), 'reploid-installed-consumer-'));
await mkdir(evidence, { recursive: true });
const report = {
  schema: 'reploid.library-package-acceptance/v1',
  node: process.version, platform: process.platform, architecture: process.arch,
  evidence, consumer, checks: [],
  scope: 'Installed ESM imports, public boundaries, declaration resolution, asset identity and deterministic browser consumer.',
  exclusions: ['Actual model inference', 'Independent peers', 'Full application acceptance', 'Publication', 'Deployment']
};
async function check(name, run) {
  const started = performance.now();
  try {
    const result = await run();
    report.checks.push({ name, status: 'passed', durationMs: performance.now() - started, result: result ?? null });
  } catch (error) {
    report.checks.push({ name, status: 'failed', durationMs: performance.now() - started,
      error: String(error.stack || error) });
  }
  process.stdout.write(name + ': ' + report.checks.at(-1).status + '\n');
}
async function command(name, executable, args, cwd) {
  try {
    const result = await execute(executable, args, { cwd, timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
    await writeFile(path.join(evidence, name + '.log'), result.stdout + result.stderr);
    return result.stdout;
  } catch (error) {
    await writeFile(path.join(evidence, name + '.log'), (error.stdout || '') + (error.stderr || '') + '\n' + String(error));
    throw error;
  }
}
async function checkDeclarations(directory, names, logName, ambientTypes = []) {
  await writeFile(path.join(directory, 'consumer.ts'), names.map((name, index) =>
    'import * as entry' + index + ' from ' + JSON.stringify(name) + ';\nvoid entry' + index + ';'
  ).join('\n'));
  await writeFile(path.join(directory, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { noEmit: true, strict: true, module: 'NodeNext', moduleResolution: 'NodeNext',
      target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: ambientTypes, skipLibCheck: false },
    files: ['consumer.ts']
  }, null, 2));
  await command(logName, process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'),
    '--project', path.join(directory, 'tsconfig.json')], directory);
  return { entries: names.length, ambientTypes };
}
let manifest = null;
let server = null;
let browser = null;
try {
  await check('pack-and-detached-install', async () => {
    const packed = JSON.parse(await command('npm-pack', 'npm', [
      'pack', './packages/reploid', '--ignore-scripts', '--json', '--pack-destination', evidence
    ], root))[0];
    const archive = path.join(evidence, packed.filename);
    report.archive = { path: archive, sha256: createHash('sha256').update(await readFile(archive)).digest('hex') };
    await writeFile(path.join(consumer, 'package.json'), JSON.stringify({
      name: 'reploid-acceptance-consumer', private: true, type: 'module',
      dependencies: { reploid: 'file:' + archive }
    }, null, 2));
    await command('npm-install', 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'], consumer);
    await assert.rejects(access(path.join(consumer, 'node_modules/doppler-gpu/package.json')), { code: 'ENOENT' });
    manifest = JSON.parse(await readFile(path.join(consumer, 'node_modules/reploid/package.json'), 'utf8'));
    return { package: manifest.name, version: manifest.version, optionalDopplerPeerInstalled: false };
  });
  if (manifest) {
    const installedRoot = path.join(consumer, 'node_modules/reploid');
    const entries = Object.entries(manifest.exports).filter(([, target]) => typeof target === 'object');
    const names = entries.map(([key]) => key === '.' ? 'reploid' : 'reploid/' + key.slice(2));
    await check('published-assets-and-application-copy', async () => {
      const assets = JSON.parse(await readFile(path.join(root, 'self/vendor/reploid/package-assets.json'), 'utf8'));
      assert.deepEqual(assets.exports, manifest.exports);
      for (const file of assets.files) {
        const installed = await readFile(path.join(installedRoot, 'src', file.path));
        const application = await readFile(path.join(root, 'self/vendor/reploid', file.path));
        assert.equal(createHash('sha256').update(installed).digest('hex'), file.sha256, file.path);
        assert.deepEqual(application, installed, file.path);
      }
      for (const target of Object.values(manifest.exports)) {
        for (const asset of typeof target === 'string' ? [target] : Object.values(target)) {
          await access(path.join(installedRoot, asset));
        }
      }
      await access(path.join(installedRoot, 'LICENSE'));
      return { matchedAssets: assets.files.length, publicEntries: names };
    });
    await check('migrated-adapters-use-public-entries', async () => {
      const publicFiles = new Set(entries.map(([, target]) => target.import.replace(/^\.\/src\//, '')));
      const adapters = [
      "self/tool-runner.js",
      "self/core/response-parser.js",
      "self/pool/p2p-transport.js",
      "self/pool/p2p-signaling.js",
      "self/pool/retry-policy.js",
      "self/receipt.js",
      "self/identity.js",
      "self/core/improvement-episode.js",
      "self/reward-policy.js",
      "self/swarm.js",
      "self/core/vfs.js",
      "self/capabilities/communication/library-adapter.js",
      "self/capabilities/communication/webrtc-swarm.js",
      "self/capabilities/communication/swarm-transport.js",
      "self/bridge.js",
      "self/runtime.js",
      "self/core/agent-loop.js",
      "self/core/cycle-artifacts.js"
];
      let imports = 0;
      for (const adapter of adapters) {
        const source = await readFile(path.join(root, adapter), 'utf8');
        for (const match of source.matchAll(/['"][^'"\n]*vendor\/reploid\/([^'"\n]+)['"]/g)) {
          assert(publicFiles.has(match[1]), adapter + ' bypasses public exports: ' + match[1]);
          imports += 1;
        }
      }
      return { adapters: adapters.length, imports };
    });
    await check('installed-node-public-imports', async () => {
      const code = `
        const results = [];
        for (const name of ${JSON.stringify(names)}) {
          try { const api = await import(name); results.push({ name, ok: true, exports: Object.keys(api) }); }
          catch (error) { results.push({ name, ok: false, error: String(error.stack || error) }); }
        }
        try { await import('reploid/src/index.js'); results.push({ name: 'private-path-rejected', ok: false }); }
        catch (error) { results.push({ name: 'private-path-rejected', ok: error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' }); }
        console.log(JSON.stringify(results));
      `;
      const output = await command('node-imports', process.execPath, ['--input-type=module', '-e', code], consumer);
      const results = JSON.parse(output.trim());
      await writeFile(path.join(evidence, 'node-imports.json'), JSON.stringify(results, null, 2));
      assert(results.every(result => result.ok), 'Public import failures; see node-imports.json');
      return results;
    });
    await check('installed-core-declarations-without-doppler', () =>
      checkDeclarations(consumer, names.filter(name => name !== 'reploid/doppler'), 'typescript-core'));
    await check('installed-configuration-regression', async () => {
      const code = `
        import assert from 'node:assert/strict';
        import { resolveConfig } from 'reploid/config';
        const config = resolveConfig({
          chain: [{ agent: { maxCycles: 10 }, webrtc: { signalingUrl: 'wss://example.test/signal' } }],
          profile: { schema: 'reploid.profile/v1', id: 'acceptance', config: { agent: { maxCycles: 11 } } },
          overrides: { agent: { maxCycles: 12 } }, request: { agent: { maxCycles: 13 } }
        });
        assert.equal(config.value.agent.maxCycles, 13);
        assert.equal(config.provenance['agent.maxCycles'], 'request-overrides');
        assert(Object.isFrozen(config.value.agent));
        assert.equal(config.value.mesh.enabled, false);
        assert.equal(resolveConfig().value.webrtc.signalingUrl, null);
        assert.throws(() => resolveConfig({ overrides: { models: { contract: { privateJwk: {} } } } }),
          /credentials belong in host ports/);
        assert.throws(() => resolveConfig({ overrides: { webrtc: { signalingUrl: 'wss://user:secret@example.test' } } }),
          /credential-free/);
        assert.throws(() => resolveConfig({ request: { mesh: { executeJobs: true } } }), /not allowlisted/);
        console.log(JSON.stringify({ precedence: true, immutable: true, secretsRejected: true, requestPolicyEnforced: true }));
      `;
      return JSON.parse((await command('configuration-regression', process.execPath,
        ['--input-type=module', '-e', code], consumer)).trim());
    });
    let dopplerConsumer = null;
    await check('doppler-fixture-install', async () => {
      const directory = await mkdtemp(path.join(tmpdir(), 'reploid-doppler-consumer-'));
      report.dopplerConsumer = directory;
      const expectedVersion = dopplerFixture.dependencies['doppler-gpu'];
      assert(/^\d+\.\d+\.\d+$/.test(expectedVersion), 'Doppler fixture must use an exact version');
      await writeFile(path.join(directory, 'package.json'), JSON.stringify({
        ...dopplerFixture, dependencies: { ...dopplerFixture.dependencies, reploid: 'file:' + report.archive.path }
      }, null, 2));
      await command('npm-install-doppler', 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], directory);
      const installedDoppler = JSON.parse(await readFile(path.join(directory, 'node_modules/doppler-gpu/package.json'), 'utf8'));
      assert.equal(installedDoppler.version, expectedVersion);
      const typePackages = {};
      for (const name of dopplerFixture.reploidAcceptance.types) {
        const expected = dopplerFixture.dependencies[name];
        assert(/^\d+\.\d+\.\d+$/.test(expected), 'Type fixture must use an exact version');
        const installed = JSON.parse(await readFile(path.join(directory, 'node_modules', name, 'package.json'), 'utf8'));
        assert.equal(installed.version, expected);
        typePackages[name] = installed.version;
      }
      await writeFile(path.join(evidence, 'doppler-package-lock.json'), await readFile(path.join(directory, 'package-lock.json')));
      dopplerConsumer = directory;
      return { version: installedDoppler.version, typePackages, directory };
    });
    if (dopplerConsumer) {
      await check('installed-declarations-with-doppler', () =>
        checkDeclarations(dopplerConsumer, names, 'typescript-doppler', dopplerFixture.reploidAcceptance.types));
      await check('installed-doppler-public-contract', async () => {
        const code = `
          import assert from 'node:assert/strict';
          import { createDopplerProvider, openDopplerProvider } from 'reploid/doppler';
          import { openCapsule } from 'doppler-gpu';
          for (const api of [createDopplerProvider, openDopplerProvider, openCapsule]) assert.equal(typeof api, 'function');
          console.log(JSON.stringify({ publicExports: true, modelExecution: false }));
        `;
        return JSON.parse((await command('doppler-public-contract', process.execPath,
          ['--input-type=module', '-e', code], dopplerConsumer)).trim());
      });
    }
    await check('browser-launch', async () => {
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
      server = createServer(async (request, response) => {
        try {
          const url = new URL(request.url, 'http://localhost');
          const file = path.resolve(consumer, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
          if (!file.startsWith(consumer + path.sep)) { response.writeHead(403).end(); return; }
          const bytes = await readFile(file);
          response.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
          response.end(bytes);
        } catch { response.writeHead(404).end(); }
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const imports = Object.fromEntries(entries.map(([key, target], index) => [
        names[index], '/node_modules/reploid/' + target.import.slice(2)
      ]));
      await writeFile(path.join(consumer, 'imports.html'), '<!doctype html><script type="importmap">' +
        JSON.stringify({ imports }) + '</script>');
      for (const file of ['index.html', 'main.js']) {
        await writeFile(path.join(consumer, file), await readFile(path.join(root, 'examples/library-consumer', file)));
      }
      browser = await chromium.launch({
        headless: true, timeout: 20000,
        ...(process.env.REPLOID_E2E_CHROMIUM_CHANNEL ? { channel: process.env.REPLOID_E2E_CHROMIUM_CHANNEL } : {})
      });
      report.browser = browser.version();
    });
    if (browser) {
      const base = 'http://127.0.0.1:' + server.address().port;
      await check('installed-browser-public-imports', async () => {
        const page = await browser.newPage();
        try {
          await page.goto(base + '/imports.html');
          const results = await page.evaluate(async names => {
            const results = [];
            for (const name of names) {
              try { const api = await import(name); results.push({ name, ok: true, exports: Object.keys(api) }); }
              catch (error) { results.push({ name, ok: false, error: String(error.stack || error) }); }
            }
            return results;
          }, names);
          await writeFile(path.join(evidence, 'browser-imports.json'), JSON.stringify(results, null, 2));
          assert(results.every(result => result.ok), 'Public import failures; see browser-imports.json');
          return results;
        } finally { await page.close(); }
      });
      await check('deterministic-browser-consumer', async () => {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(String(error.stack || error)));
        try {
          await page.goto(base + '/');
          await page.locator('#run').click();
          await page.waitForFunction(() => {
            const text = document.querySelector('#state')?.textContent || '';
            return text.includes('PARKED') && text.includes('one unpowered machine');
          }, null, { timeout: 5000 });
          assert.deepEqual(errors, []);
          await page.screenshot({ path: path.join(evidence, 'consumer.png'), fullPage: true });
          await page.locator('#close').click();
          await page.waitForFunction(() => document.querySelector('#state')?.textContent === 'Closed', null, { timeout: 5000 });
          return { model: 'deterministic-fixture', networkJobs: 0 };
        } finally {
          await writeFile(path.join(evidence, 'consumer-page-errors.json'), JSON.stringify(errors, null, 2));
          await page.close();
        }
      });
    }
  }
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  report.passed = report.checks.every(check => check.status === 'passed');
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write('Evidence: ' + path.join(evidence, 'report.json') + '\n');
  if (!report.passed) process.exitCode = 1;
}
