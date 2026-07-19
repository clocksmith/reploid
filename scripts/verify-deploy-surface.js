#!/usr/bin/env node
/**
 * @fileoverview Deploy-surface drift gate.
 * Fails when the deployed hosting surface differs from the local tree:
 * - served index.html build version must match local REPLOID_BUILD_VERSION;
 * - served poolday.css and rd.css bytes must hash-match the local files;
 * - product routes must lay out clear of the fixed nav rail.
 * Screenshots for each checked route are written to artifacts/deploy-surface.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const args = process.argv.slice(2);
const positionalUrl = args.find((arg) => !arg.startsWith('-'));
const baseUrl = String(
  positionalUrl
  || process.env.REPLOID_POOL_RELEASE_URL
  || process.env.REPLOID_POOL_DEPLOYMENT_URL
  || ''
).replace(/\/+$/, '');
const allowLocal = args.includes('--allow-local');

if (!baseUrl) {
  console.error('A deployment URL is required through a positional argument, REPLOID_POOL_RELEASE_URL, or REPLOID_POOL_DEPLOYMENT_URL');
  process.exit(1);
}
if (!allowLocal && /^https?:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl)) {
  console.error('Local deploy-surface verification requires --allow-local');
  process.exit(1);
}

const STYLE_FILES = ['styles/poolday.css', 'styles/rd.css'];
const LAYOUT_ROUTES = ['/ask', '/compute', '/records'];
const SCREENSHOT_ROUTES = ['/', ...LAYOUT_ROUTES];
const screenshotDir = path.join(repoRoot, 'artifacts', 'deploy-surface');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const localBuildVersion = () => {
  const html = fs.readFileSync(path.join(repoRoot, 'self', 'index.html'), 'utf8');
  const match = html.match(/REPLOID_BUILD_VERSION = '([^']+)'/);
  if (!match) throw new Error('self/index.html does not declare REPLOID_BUILD_VERSION');
  return match[1];
};

const fetchBytes = async (url) => {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};

const failures = [];

const checkBuildVersion = async () => {
  const expected = localBuildVersion();
  const served = (await fetchBytes(`${baseUrl}/index.html`)).toString('utf8');
  const match = served.match(/REPLOID_BUILD_VERSION = '([^']+)'/);
  const deployed = match ? match[1] : '(missing)';
  if (deployed !== expected) {
    failures.push(`build version drift: local ${expected}, deployed ${deployed}`);
  }
  return { expected, deployed };
};

const checkStylesheetBytes = async (version) => {
  for (const relative of STYLE_FILES) {
    const localHash = sha256(fs.readFileSync(path.join(repoRoot, 'self', relative)));
    const servedHash = sha256(await fetchBytes(`${baseUrl}/${relative}?v=${encodeURIComponent(version)}`));
    if (localHash !== servedHash) {
      failures.push(`stylesheet drift: ${relative} served sha256:${servedHash.slice(0, 16)} does not match local sha256:${localHash.slice(0, 16)}`);
    }
  }
};

const checkRouteLayout = async () => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    for (const route of SCREENSHOT_ROUTES) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(1500);
      const name = route === '/' ? 'home' : route.slice(1);
      await page.screenshot({ path: path.join(screenshotDir, `${name}.png`) });
      if (!LAYOUT_ROUTES.includes(route)) continue;
      const probe = await page.evaluate(() => {
        const main = document.querySelector('.pool-home');
        const rail = document.querySelector('.pool-nav-rail');
        const shell = document.querySelector('.pool-route-shell');
        if (!main || !rail || !shell) {
          return { missing: [!main && '.pool-home', !rail && '.pool-nav-rail', !shell && '.pool-route-shell'].filter(Boolean) };
        }
        const railRect = rail.getBoundingClientRect();
        const shellRect = shell.getBoundingClientRect();
        return {
          missing: [],
          paddingLeft: parseFloat(getComputedStyle(main).paddingLeft),
          railRight: railRect.right,
          shellLeft: shellRect.left
        };
      });
      if (probe.missing.length) {
        failures.push(`${route}: missing ${probe.missing.join(', ')}`);
        continue;
      }
      if (probe.shellLeft < probe.railRight) {
        failures.push(`${route}: route shell (left ${Math.round(probe.shellLeft)}px) overlaps nav rail (right ${Math.round(probe.railRight)}px)`);
      }
    }
  } finally {
    await browser.close();
  }
};

try {
  console.log(`[deploy-surface] ${baseUrl}`);
  const { expected, deployed } = await checkBuildVersion();
  await checkStylesheetBytes(deployed === '(missing)' ? expected : deployed);
  await checkRouteLayout();
  if (failures.length) {
    console.error('Deploy-surface verification failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`[deploy-surface] passed ${baseUrl} at build ${expected}; screenshots in artifacts/deploy-surface`);
} catch (error) {
  console.error(`[deploy-surface] failed: ${error.message}`);
  process.exit(1);
}
