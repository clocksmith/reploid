// The React Recent jobs page on the host's records model over in-memory storage: the timeline, its facets and
// remembered disclosures, the folded technical tools and the receipt lookup state what the vanilla page stated.
// No relay and no real receipts.
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PooldayRoot } from '@reploid/poolday-ui';
import { createRecordsModel, projectRoomActivity } from '../../apps/poolday/host/decisions/records.js';
import { RecordsPage } from '../../apps/poolday-react/src/features/records/presentation/RecordsPage';
import type { RecordsServices } from '../../apps/poolday-react/src/features/records/domain/records';
import { memoryStorage, recordsSeed, RECORDS_ROOM } from '../../apps/poolday-react/src/app/recordFixtures';

afterEach(() => cleanup());

const mount = ({ seeded = false, room = seeded ? RECORDS_ROOM : `unit-records-${Math.random()}`, relay = 'local', storage = memoryStorage(seeded ? recordsSeed : {}), verifyReceipt = vi.fn(async () => ({ ok: true })) } = {}) => {
  const services = createRecordsModel({ storage, getRoomId: () => room, relayMode: () => relay, poll: false, verifyReceipt }) as unknown as RecordsServices;
  render(
    <PooldayRoot>
      <RecordsPage services={services} />
    </PooldayRoot>,
  );
  return { services, storage, verifyReceipt };
};

describe('Recent jobs', () => {
  it('states an empty timeline and folds the technical tools away', () => {
    const { container } = { container: document.body, ...mount() };
    expect(screen.getByRole('heading', { level: 1, name: 'Recent jobs' })).toBeTruthy();
    expect(screen.getByText('Results and unfinished jobs.')).toBeTruthy();
    const ledger = container.querySelector('[data-pool-record-ledger]')!;
    expect(ledger.getAttribute('data-record-facet')).toBe('all');
    expect(within(ledger as HTMLElement).getByText('No records yet. Requests, completed runs, and contributions will appear here.')).toBeTruthy();
    const tools = container.querySelector<HTMLDetailsElement>('[data-pool-record-disclosure="technical-tools"]')!;
    expect(tools.open).toBe(false);
    expect(within(tools).getByText('This room is local to this browser profile. Use a server relay link to share across devices.')).toBeTruthy();
    expect(within(tools).getByText('No local scores yet.')).toBeTruthy();
    expect(within(tools).getByText('No answers saved yet.')).toBeTruthy();
    expect(within(tools).getByText('Protocol vBI-1.6')).toBeTruthy();
  });

  it('lists a saved answer, filters by type and remembers what is open per room', async () => {
    const user = userEvent.setup();
    const { storage } = mount({ seeded: true });
    const row = document.querySelector<HTMLDetailsElement>('[data-pool-record-disclosure^="record:receipt:"]')!;
    expect(row.textContent).toContain('Answer completed');
    expect(row.textContent).toContain('verified');
    await user.click(within(row).getByText(/Answer completed/));
    const view = JSON.parse(storage.getItem(`reploid.pool.record-view.v1::${RECORDS_ROOM}`)!);
    expect(Object.values(view.open)).toEqual([true]);
    expect(screen.getByRole('radio', { name: 'Answers (1)' })).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'Requests (0)' }));
    expect(document.querySelector('[data-pool-record-ledger]')!.getAttribute('data-record-facet')).toBe('request');
    expect(screen.getByText('No records of this type yet.')).toBeTruthy();
    expect(JSON.parse(storage.getItem(`reploid.pool.record-view.v1::${RECORDS_ROOM}`)!).facet).toBe('request');
    const receipts = document.querySelector('[data-pool-receipt-ledger]')!;
    expect(within(receipts as HTMLElement).getByRole('table', { name: 'Saved answer receipts' }).textContent).toContain('42 tok/s');
  });

  it('looks up a receipt hash: required, not found, then found and verified locally', async () => {
    const user = userEvent.setup();
    const { verifyReceipt } = mount({ seeded: true });
    const lookup = screen.getByRole('button', { name: 'Lookup' });
    expect(screen.getByText('No lookup yet.')).toBeTruthy();
    await user.click(lookup);
    expect(document.querySelector('[data-pool-receipt-result]')!.textContent).toContain('Hash is required');
    await user.type(screen.getByPlaceholderText('sha256:...'), 'sha256:missing');
    await user.click(lookup);
    expect(document.querySelector('[data-pool-receipt-result]')!.textContent).toContain('Submit a local peer-room job first, then inspect Records from this browser.');
    await user.clear(screen.getByPlaceholderText('sha256:...'));
    await user.type(screen.getByPlaceholderText('sha256:...'), recordsSeed[`reploid.receiptLedgerRows.v1::${RECORDS_ROOM}`][0].receiptHash);
    await user.click(lookup);
    expect(document.querySelector('[data-pool-receipt-result]')!.textContent).toContain('requesterAcceptance');
    expect(verifyReceipt).not.toHaveBeenCalled();
  });
});

describe('room activity projection', () => {
  it('states checking, unavailable and counted activity as the vanilla table did', () => {
    expect(projectRoomActivity(null, 'server')).toEqual({ state: 'checking', text: 'Checking room activity...' });
    expect(projectRoomActivity({ error: 'offline' }, 'server').text).toBe('Room activity unavailable: offline');
    expect(projectRoomActivity({ relay: 'server', messageCount: 3, peerCount: 2, providerCount: 1, recent: [] }, 'server')).toEqual({
      state: 'ready', row: ['server', '3', '2', '1'], recent: 'No shared-room messages yet.',
    });
  });
});
