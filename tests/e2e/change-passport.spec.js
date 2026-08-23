import { expect, test } from '@playwright/test';

import { createChangeControlService } from '../../server/change-control/service.js';
import { createMemoryChangeControlStore } from '../../server/change-control/store.js';
import {
  advanceServiceToApproval,
  auth,
  createServiceFixturePolicy,
  createServiceStartPayload
} from '../fixtures/change-passport/service-fixture.js';

const PASSPORT_ID = 'passport:service:1';
const readAuth = auth('authority:change', ['change_authority']);
const reviewerAuth = auth('authority:reviewer', ['security_reviewer']);

const createApprovedService = async () => {
  const service = createChangeControlService({ store: createMemoryChangeControlStore() });
  const policy = await createServiceFixturePolicy();
  await service.createPassport({
    payload: createServiceStartPayload(policy),
    role: 'proposer',
    idempotencyKey: 'e2e:create'
  }, auth('authority:proposer', ['proposer']));
  await advanceServiceToApproval(service);
  return service;
};

const fulfillJson = (route, body, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body)
});

const installChangeControlApi = async (page, service) => {
  await page.route('**/change-control/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = decodeURIComponent(url.pathname.replace(/^\/change-control/, ''));
    try {
      expect(request.headers().authorization).toBe('Bearer e2e-token');
      if (request.method() === 'GET' && path === '/principal') {
        return fulfillJson(route, {
          authorityId: 'authority:e2e-operator',
          organizationId: 'org:test',
          roles: ['proposer', 'evidence_producer', 'evaluator', 'security_reviewer', 'change_authority', 'activator', 'observer', 'rollback_authority'],
          authenticationKind: 'e2e_token'
        });
      }
      if (request.method() === 'GET' && path === '/passports') {
        return fulfillJson(route, { passports: await service.listPassports(readAuth) });
      }
      if (request.method() === 'GET' && path === `/passports/${PASSPORT_ID}`) {
        return fulfillJson(route, await service.getPassport(PASSPORT_ID, readAuth));
      }
      if (request.method() === 'GET' && path === `/passports/${PASSPORT_ID}/events`) {
        return fulfillJson(route, { events: await service.getEvents(PASSPORT_ID, readAuth) });
      }
      if (request.method() === 'GET' && path === `/passports/${PASSPORT_ID}/export`) {
        return fulfillJson(route, await service.exportPassport(PASSPORT_ID, readAuth));
      }
      if (request.method() === 'POST' && path === `/passports/${PASSPORT_ID}/events`) {
        const body = request.postDataJSON();
        const principal = body.role === 'security_reviewer' ? reviewerAuth : readAuth;
        return fulfillJson(route, await service.appendEvent({
          passportId: PASSPORT_ID,
          ...body,
          idempotencyKey: request.headers()['idempotency-key']
        }, principal));
      }
      return fulfillJson(route, { error: `Unhandled E2E route: ${request.method()} ${path}` }, 404);
    } catch (error) {
      return fulfillJson(route, { error: error.message, code: error.code || 'E2E_API_ERROR' }, error.statusCode || 400);
    }
  });
};

const connect = async (page) => {
  await page.goto('/passports');
  await page.getByLabel('Access token').fill('e2e-token');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('[data-passport-detail]')).toHaveAttribute('data-passport-detail', PASSPORT_ID);
};

test.describe('Change Passport operator journey', () => {
  test('keeps evidence, decision, and effect separate and records an attributed review', async ({ page }) => {
    const service = await createApprovedService();
    await installChangeControlApi(page, service);
    await connect(page);

    await expect(page.locator('[data-axis="Evidence"] strong')).toHaveText('frozen');
    await expect(page.locator('[data-axis="Decision"] strong')).toHaveText('approved');
    await expect(page.locator('[data-axis="Effect"] strong')).toHaveText('not_applied');
    await expect(page.getByText('Eligible under the frozen policy.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Excluded evidence' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Objections and disagreement' })).toBeVisible();

    const review = page.locator('[data-form="review"]');
    await review.getByLabel('Rationale').fill('Second operator confirms the frozen evidence and rollback identity.');
    await review.getByRole('button', { name: 'Record review' }).click();
    await expect(page.getByRole('status')).toHaveText('Review recorded.');
    await expect(page.getByText(
      'Second operator confirms the frozen evidence and rollback identity.',
      { exact: true }
    )).toBeVisible();

    const projection = (await service.getPassport(PASSPORT_ID, readAuth)).projection;
    expect(projection.reviews).toHaveLength(2);
    expect(projection.reviews[1].actor).toMatchObject({
      authorityId: 'authority:reviewer',
      role: 'security_reviewer'
    });
    expect(projection.effect.state).toBe('not_applied');
  });

  test('verifies and downloads a replayable export in the browser', async ({ page }) => {
    const service = await createApprovedService();
    await installChangeControlApi(page, service);
    await connect(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export and verify' }).click()
    ]);
    await expect(page.getByRole('status')).toHaveText('Export verified and downloaded.');
    expect(download.suggestedFilename()).toBe('passport_service_1.change-passport.json');
  });

  test('keeps all operator actions reachable at a narrow viewport', async ({ page }) => {
    const service = await createApprovedService();
    await installChangeControlApi(page, service);
    await page.setViewportSize({ width: 390, height: 844 });
    await connect(page);

    await expect(page.locator('[data-axis="Evidence"]')).toBeVisible();
    await expect(page.locator('[data-form="review"]')).toBeVisible();
    await expect(page.locator('[data-form="decision"]')).toBeVisible();
    await expect(page.locator('[data-form="lifecycle"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
