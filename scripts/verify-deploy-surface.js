#!/usr/bin/env node
/**
 * @fileoverview Deploy-surface drift gate.
 * Fails when the deployed hosting surface differs from the local tree:
 * - served index.html build version must match local REPLOID_BUILD_VERSION;
 * - served Poolday route modules and styles must hash-match the local files;
 * - product routes must open the React shell's frame for that route, with its navigation bar and
 *   main column clear of each other in either layout orientation.
 * Screenshots for each checked route are written to artifacts/deploy-surface.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { rectanglesOverlap } from './deploy-surface-layout.js';
import {
  consoleFailure,
  httpResponseFailure,
  isTurnCredentialRequest,
  selfInflictedTurnRefusal,
  turnBudgetWaitMs
} from './deploy-surface-diagnostics.js';
import { openBrowserTree, resolveServedFile } from '../server/browser-tree.js';
import turnPolicy from '../server/cloudflare/policy.json' with { type: 'json' };

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

const STYLE_FILES = [
  'styles/poolday/tokens.css',
  'styles/poolday/primitives/base.css',
  'styles/poolday/primitives/controls.css',
  'styles/poolday/primitives/workspace.css',
  'styles/rd.css'
];
// These modules make up the requester, provider, relay, and visible result
// path. A build label alone cannot prove that Hosting served the matching
// browser bundle, especially after a partial static deployment.
// The product shell is one React bundle that compiles in the host and pool code it uses.
const POOLDAY_MODULE_FILES = [
  'ui/react/app.js',
  'pool/sdk.js',
  'pool/peer-rendezvous.js',
  'pool/p2p-transport.js',
  'pool/peer-room.js',
  'pool/retry-policy.js'
];
const LAYOUT_ROUTES = ['/', '/ask', '/compute', '/records', '/room-1'];
const SCREENSHOT_ROUTES = LAYOUT_ROUTES;
// The React shell (apps/poolday-react) frames every route in one @reploid/poolday-ui Workspace: the
// conversation workspace at / and a page of its own, marked with its name, everywhere else. Its
// navigation bar and main column are the frame's <nav> and <main> landmarks.
const frameSelector = (route) => (route === '/'
  ? '[data-react-shell] [data-chat-workspace]'
  : `[data-react-shell] [data-route-page="${route.slice(1)}"]`);
// Room for this many TURN credential requests per page load: the load's own and one renewal.
const TURN_REQUESTS_PER_LOAD = 2;
// Clock skew between this machine and the Worker's admission window.
const TURN_WINDOW_MARGIN_MS = 1000;
const VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 390, height: 844 }
];
const screenshotDir = path.join(repoRoot, 'artifacts', 'deploy-surface');

let treeOpening;
const browserTree = () => (treeOpening ||= openBrowserTree({ repoRoot }));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const localBuildVersion = () => {
  const html = fs.readFileSync(resolveServedFile('index.html', { repoRoot }), 'utf8');
  const match = html.match(/REPLOID_BUILD_VERSION = '([^']+)'/);
  if (!match) throw new Error('index.html does not declare REPLOID_BUILD_VERSION');
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
    // Compare the bytes Hosting serves for this path, from whichever source root holds it.
    const localHash = sha256(await (await browserTree()).read(relative));
    const servedHash = sha256(await fetchBytes(`${baseUrl}/${relative}?v=${encodeURIComponent(version)}`));
    if (localHash !== servedHash) {
      failures.push(`stylesheet drift: ${relative} served sha256:${servedHash.slice(0, 16)} does not match local sha256:${localHash.slice(0, 16)}`);
    }
  }
};

const checkPooldayModuleBytes = async (version) => {
  for (const relative of POOLDAY_MODULE_FILES) {
    const localHash = sha256(await (await browserTree()).read(relative));
    try {
      const servedHash = sha256(await fetchBytes(`${baseUrl}/${relative}?v=${encodeURIComponent(version)}&deploy-surface=1`));
      if (localHash !== servedHash) {
        failures.push(`Poolday module drift: ${relative} served sha256:${servedHash.slice(0, 16)} does not match local sha256:${localHash.slice(0, 16)}`);
      }
    } catch (error) {
      failures.push(`Poolday module missing or unreadable: ${relative} (${error.message})`);
    }
  }
};

const checkRouteLayout = async () => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  // Layout qualification needs the supported browser defaults, not a GPU override.
  const browser = await chromium.launch();
  // Route checks represent navigation by one visitor, not a burst of new
  // anonymous Firebase accounts for every viewport and retry.
  const context = await browser.newContext();
  // Every page load asks the signaling Worker for TURN credentials; pace loads inside its per-visitor budget.
  const turnRequests = [], turnAdmitted = [];
  context.on('request', (request) => { if (isTurnCredentialRequest(request.url())) turnRequests.push(Date.now()); });
  context.on('response', (response) => {
    if (isTurnCredentialRequest(response.url()) && response.ok()) turnAdmitted.push(Date.now());
  });
  const paceTurnBudget = async (label) => {
    const waitMs = turnBudgetWaitMs(turnRequests, Date.now(), turnPolicy, TURN_REQUESTS_PER_LOAD);
    if (!waitMs) return;
    console.log(`[deploy-surface] ${label}: waiting ${Math.ceil((waitMs + TURN_WINDOW_MARGIN_MS) / 1000)} s for the TURN credential budget (${turnPolicy.turnPerSubject} per ${turnPolicy.turnWindowMs / 1000} s per visitor)`);
    await new Promise((resolve) => setTimeout(resolve, waitMs + TURN_WINDOW_MARGIN_MS));
  };
  try {
    for (const { route, viewport } of SCREENSHOT_ROUTES.flatMap((route) =>
      VIEWPORTS.map((viewport) => ({ route, viewport })))) {
      let routeFailure = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const page = await context.newPage();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        const browserIssues = [];
        const diagnostics = new Set();
        let authenticationFailure = null, retryAfterMs = 0;
        page.on('pageerror', (error) => browserIssues.push(error.message));
        page.on('response', (response) => {
          if (response.status() < 400) return;
          // This check's own page loads share one visitor's rate budget; a refusal says when to retry.
          if (response.status() === 429 && isTurnCredentialRequest(response.url())
            && selfInflictedTurnRefusal(turnAdmitted, Date.now(), turnPolicy)) {
            // Only reachable if pacing undercounts: this visitor alone spent its budget, so the refusal
            // is this check's doing, not the deployment's. Wait it out and load the route again.
            diagnostics.add(`TURN credentials refused after this check's own ${turnPolicy.turnPerSubject} admitted requests in ${turnPolicy.turnWindowMs / 1000} s`);
            retryAfterMs = Math.max(retryAfterMs, turnPolicy.turnWindowMs);
            browserIssues.push('self-inflicted TURN refusal; retrying after the window');
            return;
          }
          if (response.status() === 429) {
            const seconds = Number(response.headers()['retry-after']);
            retryAfterMs = Math.max(retryAfterMs, Math.min(60000, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 10000));
          }
          const failure = httpResponseFailure({ url: response.url(), status: response.status(),
            method: response.request().method() }, baseUrl);
          if (failure) browserIssues.push(failure);
          const responseUrl = new URL(response.url());
          if (failure && responseUrl.hostname === 'identitytoolkit.googleapis.com'
            && responseUrl.pathname.endsWith('/accounts:signUp')) authenticationFailure = failure;
          else if (!failure) diagnostics.add(`Optional service is not published (GET ${responseUrl.pathname}: HTTP 404)`);
        });
        page.on('requestfailed', (request) => {
          const url = new URL(request.url());
          browserIssues.push(`${request.method()} ${url.origin}${url.pathname}: ${request.failure()?.errorText || 'request failed'}`);
        });
        page.on('console', (message) => {
          if (message.type() === 'error' || message.type() === 'warning') {
            const failure = consoleFailure(message.type(), message.text());
            if (failure) browserIssues.push(failure);
            else if (!message.text().startsWith('Failed to load resource:')) diagnostics.add(message.text());
          }
        });
        try {
          await paceTurnBudget(`${route} (${viewport.label})`);
          await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await page.waitForSelector(`${frameSelector(route)} > main`, { timeout: 20000 });
          await page.waitForTimeout(1500);
          for (const diagnostic of diagnostics) console.log(`[deploy-surface] ${route} (${viewport.label}) diagnostic: ${diagnostic}`);
          if (browserIssues.length) {
            throw new Error(`browser issues: ${browserIssues.join(' | ')}`);
          }
          const name = `${route === '/' ? 'home' : route.slice(1)}${viewport.label === 'mobile' ? '-mobile' : ''}`;
          await page.screenshot({ path: path.join(screenshotDir, `${name}.png`) });
          if (LAYOUT_ROUTES.includes(route)) {
            const probe = await page.evaluate(async (selector) => {
              const frame = document.querySelector(selector);
              const rail = frame?.querySelector(':scope > nav');
              const shell = frame?.querySelector(':scope > main');
              if (!frame || !rail || !shell) {
                return { missing: [!frame && selector, !rail && `${selector} > nav`, !shell && `${selector} > main`].filter(Boolean) };
              }
              let railRect = rail.getBoundingClientRect();
              // The mobile dock intentionally overlays a scrolling document.
              // Its contract is that the final content can scroll clear of it,
              // not that the entire long document fits above the viewport dock.
              if (getComputedStyle(rail).position === 'fixed' && railRect.top > innerHeight / 2) {
                window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
                await new Promise(requestAnimationFrame);
                railRect = rail.getBoundingClientRect();
              }
              const shellRect = shell.getBoundingClientRect();
              return {
                missing: [],
                navigation: { left: railRect.left, right: railRect.right, top: railRect.top, bottom: railRect.bottom },
                content: { left: shellRect.left, right: shellRect.right, top: shellRect.top, bottom: shellRect.bottom }
              };
            }, frameSelector(route));
            if (probe.missing.length) {
              throw new Error(`missing ${probe.missing.join(', ')}`);
            }
            if (rectanglesOverlap(probe.navigation, probe.content)) {
              throw new Error(
                `main column ${JSON.stringify(probe.content)} overlaps navigation ${JSON.stringify(probe.navigation)}`
              );
            }
          }
          routeFailure = null;
          break;
        } catch (error) {
          // A provider refusal must stop the campaign, not create more fresh
          // anonymous sign-ups through route and viewport retries.
          if (authenticationFailure) throw new Error(`Authentication unavailable; qualification stopped: ${authenticationFailure}`);
          routeFailure = `${route} (${viewport.label}): attempt ${attempt} failed: ${error.message}`;
        } finally {
          await page.close();
        }
        if (attempt < 3 && routeFailure) {
          await new Promise((resolve) => setTimeout(resolve, retryAfterMs || 250));
        }
      }
      if (routeFailure) failures.push(routeFailure);
    }
  } finally {
    await browser.close();
  }
};

try {
  console.log(`[deploy-surface] ${baseUrl}`);
  const { expected, deployed } = await checkBuildVersion();
  await checkStylesheetBytes(deployed === '(missing)' ? expected : deployed);
  await checkPooldayModuleBytes(deployed === '(missing)' ? expected : deployed);
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
