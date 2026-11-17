import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, chromium } from '@playwright/test';
import { readServedHarnessFile } from '../helpers/served-browser-files.js';

const origin = 'http://127.0.0.1:5198';
const serve = context => context.route(origin + '/**', async route => {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Identity continuity fixture</title>' });
  const body = await readServedHarnessFile('/self' + pathname);
  return body ? route.fulfill({ contentType: pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body }) : route.abort();
});
const acquire = page => page.evaluate(async () => {
  const { createContributorIdentity } = await import('/host/contributor-identity.js');
  const { ensureReploidWindowInstance, getCurrentReploidStorage } = await import('/instance.js');
  ensureReploidWindowInstance(window);
  window.owner = createContributorIdentity({ storage: getCurrentReploidStorage() });
  const identity = await window.owner.ensure();
  // Return public information only. Private keys remain in the test profile.
  return { peerId: identity.peerId, publicJwk: identity.publicJwk };
});

test('real Web Locks preserve signing identity across reload and separate concurrent tabs', async ({ context, page }) => {
  await serve(context); await page.goto(origin);
  const first = await acquire(page);
  const firstScope = await page.evaluate(() => window.REPLOID_INSTANCE_ID);
  await page.reload();
  expect(await acquire(page)).toEqual(first);
  const other = await context.newPage(); await other.goto(origin);
  await other.evaluate(() => sessionStorage.setItem('REPLOID_CONTRIBUTOR_SLOT_V1', '0'));
  const second = await acquire(other);
  expect(await other.evaluate(() => window.REPLOID_INSTANCE_ID)).not.toBe(firstScope);
  expect(second.peerId).not.toBe(first.peerId);
  await other.reload();
  expect(await acquire(other)).toEqual(second);
  await other.evaluate(() => window.owner.close());
  await page.close();
  expect(await acquire(other)).toEqual(second);
  await other.evaluate(() => window.owner.close());
});


test('a fresh browser process reuses the profile signing identity', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'reploid-identity-test-'));
  let context;
  const launch = () => chromium.launchPersistentContext(profile, {
    headless: true, ...(process.env.REPLOID_E2E_CHROMIUM_CHANNEL ? { channel: process.env.REPLOID_E2E_CHROMIUM_CHANNEL } : {})
  });
  try {
    context = await launch(); await serve(context);
    const page = await context.newPage(); await page.goto(origin);
    const first = await acquire(page);
    const firstScope = await page.evaluate(() => window.REPLOID_INSTANCE_ID);
    await context.close();
    context = await launch(); await serve(context);
    const restarted = await context.newPage(); await restarted.goto(origin);
    expect(await acquire(restarted)).toEqual(first);
    expect(await restarted.evaluate(() => window.REPLOID_INSTANCE_ID)).not.toBe(firstScope);
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});
