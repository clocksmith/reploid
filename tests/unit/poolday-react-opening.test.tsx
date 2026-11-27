// How the React product opens this page's host: the ordered participation it asks the session for, and
// the opening's lifecycle (a late host after unmount is closed, a failed opening never binds a screen).
// Ported from the vanilla shell's entry tests (ordered-browser-entry, canonical-shell-opening).
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import orderedPolicy from '../../apps/poolday/config/ordered-participation.json' with { type: 'json' };
import { isWorkOrderedModel } from '../../apps/poolday/host/work-partition-plan.js';
import { ProductApp } from '../../apps/poolday-react/src/app/ProductApp';
import type { AppServices } from '../../apps/poolday-react/src/app/services';
import { createAppearanceStore } from '../../apps/poolday-react/src/features/shell/infrastructure/appearance';
import { openPageHost, type OpenedProduct } from '../../apps/poolday-react/src/features/shell/infrastructure/productHost';

const ports = vi.hoisted(() => ({ create: vi.fn(), models: null as unknown[] | null, actual: [] as unknown[] }));
vi.mock('../../apps/poolday/host/product-session.js', () => ({ createProductSession: ports.create }));
// No earning loop: the session options are the subject here.
vi.mock('../../apps/poolday/host/credits/browser.js', () => ({ openBrowserEarning: async () => null, deferredEarning: (opening: unknown) => opening }));
vi.mock('../../shared/config/doppler-local-models.js', async (original) => {
  const actual = (await original()) as { LOCAL_DOPPLER_MODELS: unknown[] };
  ports.actual = actual.LOCAL_DOPPLER_MODELS;
  return { ...actual, get LOCAL_DOPPLER_MODELS() { return ports.models ?? actual.LOCAL_DOPPLER_MODELS; } };
});

const ordered = { id: 'ordered', identity: 'sha256:' + 'a'.repeat(64), partitionPlan: { schema: 'doppler.layer-partition-contract/v3', stageCount: 3 } };
const stage = { modelId: 'ordered', index: 0, residentId: 'resident', executionId: 'execution' };
const opened: OpenedProduct[] = [];

afterEach(async () => {
  cleanup();
  for (const product of opened.splice(0)) await product.close();
  ports.create.mockReset();
  ports.models = null;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

/** Opens the page host on a stub session and returns the options the session was created with. */
async function openOptions() {
  ports.create.mockReturnValue({ close: vi.fn(async () => {}) });
  opened.push(await openPageHost());
  return ports.create.mock.calls.at(-1)[0];
}

it('the installed entry makes a weightless ordered requester with versioned limits', async () => {
  expect(orderedPolicy.schema).toBe('reploid.ordered-participation/v1');
  for (const value of Object.values(orderedPolicy.limits)) expect(Number.isSafeInteger(value) && (value as number) > 0).toBe(true);
  ports.models = [ordered];
  const options = await openOptions();
  expect(options.ordered).toEqual({ stage: null, ...orderedPolicy.limits });
  expect(options.canonical).toBeNull();
});

it('a catalog with no ordered model keeps ordinary participation', async () => {
  ports.models = ports.actual.filter((model) => !isWorkOrderedModel(model));
  expect(ports.models.length).toBeGreaterThan(0);
  expect((await openOptions()).ordered).toBeNull();
});

it('only this instance operator storage assigns a stage; links neither supply nor inherit one', async () => {
  ports.models = [ordered];
  localStorage.setItem(orderedPolicy.stageStorageKey, JSON.stringify(stage));
  expect((await openOptions()).ordered).toEqual({ stage, ...orderedPolicy.limits });
  const linked = new URLSearchParams({ instance: 'linked', stage: JSON.stringify(stage), [orderedPolicy.stageStorageKey]: JSON.stringify(stage) });
  window.history.replaceState(null, '', '/?' + linked);
  expect((await openOptions()).ordered).toEqual({ stage: null, ...orderedPolicy.limits });
});

it('rejects a malformed operator stage before any session is created', async () => {
  for (const [saved, message] of [['{"modelId":', 'not valid JSON'], ['null', 'one explicit stage object'], ['[1]', 'one explicit stage object']]) {
    localStorage.setItem(orderedPolicy.stageStorageKey, saved);
    await expect(openPageHost()).rejects.toThrow(message);
  }
  expect(ports.create).not.toHaveBeenCalled();
});

function product(): OpenedProduct & { close: ReturnType<typeof vi.fn> } {
  return { host: {}, earning: Promise.resolve(null), close: vi.fn(async () => {}),
    handover: { getState: () => null, subscribe: () => () => {}, request: () => {} } } as unknown as OpenedProduct & { close: ReturnType<typeof vi.fn> };
}

function app(open: AppServices['open']) {
  const services = { open, appearance: createAppearanceStore(null), route: 'examples' } as unknown as AppServices;
  return render(<ProductApp services={services} />);
}

it('closes a host that arrives after the product was unmounted, without binding it', async () => {
  let resolve!: (value: OpenedProduct) => void;
  const late = product();
  const view = app(() => new Promise((done) => { resolve = done; }));
  expect(view.container.querySelector('[data-app-opening="opening"]')).not.toBeNull();
  view.unmount();
  await act(async () => { resolve(late); await Promise.resolve(); });
  expect(late.close).toHaveBeenCalledOnce();
});

it('a failed opening reports the failure and binds no screen', async () => {
  const view = app(() => Promise.reject(new Error('history writer unavailable')));
  await act(async () => { await Promise.resolve(); });
  expect(view.container.querySelector('[data-app-opening="failed"]')?.textContent).toContain('history writer unavailable');
  expect(view.container.querySelector('[data-route-page]')).toBeNull();
});

it('a full page unload closes the open host', async () => {
  const open = product();
  app(async () => open);
  await act(async () => { await Promise.resolve(); });
  window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  expect(open.close).toHaveBeenCalled();
});
