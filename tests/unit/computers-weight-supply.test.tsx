// The weight-supply block of "Contribute this computer" in the React Computers pane, over the session's five
// weight-supply commands (apps/poolday/host/chat-session.js) and its projection (host/weight-supply-host.js getState).
import { StrictMode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PooldayRoot } from '@reploid/poolday-ui';
import { createComputersServices, STORAGE_CAP_OPTIONS, WEIGHT_SUPPLY_FLAG } from '../../apps/poolday-react/src/features/computers/infrastructure/hostComputers';
import { ComputersPanel } from '../../apps/poolday-react/src/features/computers/presentation/ComputersPanel';
import { computers as t } from '../../apps/poolday-react/src/l10n/computers';

const MIB = 1024 * 1024;
const LARGEST = Math.max(...STORAGE_CAP_OPTIONS);

beforeEach(() => window.localStorage.setItem(WEIGHT_SUPPLY_FLAG, '1'));
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

type Supply = Record<string, unknown> & { recommendation: unknown; approval: unknown; paused: boolean };
const idle = (): Supply => ({ recommendation: null, approval: null, paused: false, verifiedBytes: 0, servedBytes: 0, servedTransfers: 0,
  acquisition: { queuedPieces: 0, acquiringPieces: 0, failedPieces: 0, pendingBytes: 0 }, error: null });
const offer = (downloadBytes: number, expiresAt = Date.now() + 600000, offerId = 'wso_1') => ({
  offer: { offerId, totalDownloadBytes: downloadBytes, pieces: [{}, {}, {}], expiresAt }, noOffer: null });

/** A session whose weight supply behaves like weight-supply-host.js: each command changes the projection and notifies. */
function fakeSession(initial: Supply | null, { offers = [offer(40 * MIB)] }: { offers?: ReturnType<typeof offer>[] } = {}) {
  let supply = initial;
  const listeners = new Set<(state: object) => void>();
  const state = () => ({ models: [], network: { weightSupply: supply } });
  const notify = () => { for (const listener of listeners) listener(state()); };
  let issued = 0;
  const commands = {
    recommendWeightSupply: vi.fn(async (_options: { storageCapBytes: number }) => {
      await Promise.resolve();
      supply = { ...supply!, recommendation: offers[Math.min(issued++, offers.length - 1)] };
      notify();
    }),
    approveWeightSupply: vi.fn(async ({ storageCapBytes }: { offerId: string; storageCapBytes: number }) => {
      supply = { ...supply!, recommendation: null, approval: { storageCapBytes, expiresAt: Date.now() + 86400000 },
        acquisition: { queuedPieces: 3, acquiringPieces: 0, failedPieces: 0, pendingBytes: 40 * MIB } };
      notify();
    }),
    refreshWeightSupply: vi.fn(async () => null),
    pauseWeightSupply: vi.fn(async () => { supply = { ...supply!, paused: true }; notify(); }),
    resumeWeightSupply: vi.fn(async () => { supply = { ...supply!, paused: false }; notify(); }),
    setComputeContribution: vi.fn(async () => undefined),
    setCachedFileContribution: vi.fn(async () => undefined),
  };
  const session = {
    getState: state,
    subscribe: (listener: (state: object) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    ...commands,
  };
  return { session, commands, set: (next: Supply | null) => { supply = next; notify(); } };
}

function mount(session: object) {
  const services = createComputersServices({ host: { chat: session }, earning: Promise.resolve(null) });
  const view = render(<StrictMode><PooldayRoot><ComputersPanel services={services} filter={null} onClearFilter={() => undefined} /></PooldayRoot></StrictMode>);
  return { ...view, query: (selector: string) => view.container.querySelector(selector) as HTMLElement | null };
}
const openSection = () => userEvent.click(screen.getByText(t.device.contribute));

it('shows nothing without the dev flag, and nothing before a connection', async () => {
  window.localStorage.removeItem(WEIGHT_SUPPLY_FLAG);
  const off = fakeSession(idle());
  const first = mount(off.session);
  await openSection();
  expect(first.query('[data-weight-supply]')).toBeNull();
  expect(first.container.textContent).not.toContain('OWNER:');
  expect(off.commands.recommendWeightSupply).not.toHaveBeenCalled();
  cleanup();

  window.localStorage.setItem(WEIGHT_SUPPLY_FLAG, '1');
  const offline = fakeSession(null);
  const second = mount(offline.session);
  await openSection();
  expect(second.query('[data-weight-supply]')).toBeNull();
  expect(offline.commands.recommendWeightSupply).not.toHaveBeenCalled();
});

it('asks once on opening with the largest cap as the upper bound, and approves only with the cap the person chose', async () => {
  const { session, commands } = fakeSession(idle());
  const { query } = mount(session);
  expect(commands.recommendWeightSupply).not.toHaveBeenCalled();
  await openSection();
  await waitFor(() => expect(query('[data-weight-supply]')?.dataset.weightSupplyState).toBe('offer'));
  // React's development double run sends one request.
  expect(commands.recommendWeightSupply).toHaveBeenCalledTimes(1);
  expect(commands.recommendWeightSupply).toHaveBeenCalledWith({ storageCapBytes: LARGEST });

  // No default cap: Approve does nothing until one is chosen, and caps under the 40 MiB download are disabled.
  const radios = [...query('[data-weight-supply-cap]')!.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
  expect(radios.map((radio) => [Number(radio.value), radio.disabled, radio.checked])).toEqual(
    STORAGE_CAP_OPTIONS.map((bytes) => [bytes, bytes < 40 * MIB, false]));
  await userEvent.click(query('[data-weight-supply-approve]')!);
  expect(commands.approveWeightSupply).not.toHaveBeenCalled();

  await userEvent.click(radios.find((radio) => Number(radio.value) === 64 * MIB)!);
  await userEvent.click(query('[data-weight-supply-approve]')!);
  expect(commands.approveWeightSupply).toHaveBeenCalledWith({ offerId: 'wso_1', storageCapBytes: 64 * MIB });
  await waitFor(() => expect(query('[data-weight-supply]')?.dataset.weightSupplyState).toBe('approved'));
  expect(query('[data-weight-supply]')!.textContent).toContain('64.0 MiB');
  expect(commands.recommendWeightSupply).toHaveBeenCalledTimes(1);
});

it('restores an approval without asking, and pauses weight supply without touching Answer requests', async () => {
  const pieceId = `sha256:${'c'.repeat(64)}`;
  const { session, commands } = fakeSession({ ...idle(), approval: { storageCapBytes: 256 * MIB, expiresAt: Date.now() + 86400000 },
    verifiedBytes: 4 * MIB, transfers: [{ transferId: 't1', pieceId, deliveredBytes: 4 * MIB, roles: { consumer: { connectionId: 'consumer-1' } } }] });
  const { query } = mount(session);
  await openSection();
  expect(query('[data-weight-supply]')?.dataset.weightSupplyState).toBe('approved');
  expect(query('[data-weight-supply]')?.dataset.weightSupplyVerifiedBytes).toBe(String(4 * MIB));
  expect(commands.recommendWeightSupply).not.toHaveBeenCalled();
  // Each served-transfer record names the piece, the bytes delivered and the consumer's connection.
  expect(query('[data-weight-supply-transfer="t1"]')?.dataset).toMatchObject({ piece: pieceId, deliveredBytes: String(4 * MIB), consumer: 'consumer-1' });

  await userEvent.click(query('[data-weight-supply-pause]')!);
  expect(commands.pauseWeightSupply).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(query('[data-weight-supply]')?.dataset.weightSupplyPaused).toBe('true'));
  expect(commands.setComputeContribution).not.toHaveBeenCalled();
  expect(commands.setCachedFileContribution).not.toHaveBeenCalled();
  expect(query('[data-weight-supply-pause]')!.textContent).toContain(t.weightSupply.resume);
  await userEvent.click(query('[data-weight-supply-pause]')!);
  expect(commands.resumeWeightSupply).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(query('[data-weight-supply]')?.dataset.weightSupplyPaused).toBe('false'));

  // Under an approval, Refresh is the library's replacement pass, not a new recommendation.
  await userEvent.click(query('[data-weight-supply-refresh]')!);
  expect(commands.refreshWeightSupply).toHaveBeenCalledTimes(1);
  expect(commands.recommendWeightSupply).not.toHaveBeenCalled();
});

it('asks again only on Refresh or when the shown offer expires while open', async () => {
  const soon = Date.now() + 300;
  const { session, commands } = fakeSession(idle(), { offers: [offer(8 * MIB, soon, 'wso_a'), offer(8 * MIB, Date.now() + 600000, 'wso_b'), offer(8 * MIB, Date.now() + 600000, 'wso_c')] });
  const { query } = mount(session);
  await openSection();
  await waitFor(() => expect(query('[data-weight-supply-offer="wso_a"]')).not.toBeNull());
  expect(commands.recommendWeightSupply).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(query('[data-weight-supply-offer="wso_b"]')).not.toBeNull(), { timeout: 2000 });
  expect(commands.recommendWeightSupply).toHaveBeenCalledTimes(2);
  await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
  expect(commands.recommendWeightSupply).toHaveBeenCalledTimes(2);
  await userEvent.click(query('[data-weight-supply-refresh]')!);
  await waitFor(() => expect(query('[data-weight-supply-offer="wso_c"]')).not.toBeNull());
  expect(commands.recommendWeightSupply).toHaveBeenCalledTimes(3);
});

it('states no offer by its reason and shows a failed command in the block', async () => {
  const { session, commands } = fakeSession(idle(), { offers: [{ offer: null, noOffer: 'no-under-supplied-piece' } as never] });
  const { query } = mount(session);
  await openSection();
  await waitFor(() => expect(query('[data-weight-supply-no-offer]')?.dataset.weightSupplyNoOffer).toBe('no-under-supplied-piece'));
  expect(query('[data-weight-supply-no-offer]')!.textContent).toBe(t.weightSupply.noOffer['no-under-supplied-piece']);
  expect(commands.recommendWeightSupply).toHaveBeenCalledTimes(1);
  commands.recommendWeightSupply.mockRejectedValueOnce(new Error('Connect before contributing storage'));
  await userEvent.click(query('[data-weight-supply-refresh]')!);
  await waitFor(() => expect(query('[data-weight-supply-error]')?.textContent).toContain('Connect before contributing storage'));
});
