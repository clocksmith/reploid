import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PEER_MESSAGE_TYPES } from '../../self/pool/peer-control-plane.js';
import {
  addReceiptLedgerRow,
  findReceiptLedgerRecord,
  getPooldayRecordStorageKeys,
  renderPeerLedgerState,
  renderReceiptLedger,
  renderRoomActivity,
  renderRouteDetail,
  setResult
} from '../../self/ui/pool-home/view.js';

const createMemoryStorage = () => {
  const store = new Map();
  return {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    keys: () => [...store.keys()]
  };
};

const setRoom = (roomId) => {
  vi.stubGlobal('window', {
    location: { search: `?room=${encodeURIComponent(roomId)}` },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  });
};

describe('Poolday record ledgers', () => {
  let storage;

  beforeEach(() => {
    storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists receipt rows by room and extracts nested provider ids', () => {
    const roomA = `record-room-a-${crypto.randomUUID()}`;
    const roomB = `record-room-b-${crypto.randomUUID()}`;
    setRoom(roomA);
    const keysA = getPooldayRecordStorageKeys();

    addReceiptLedgerRow({
      jobId: 'peer_job_a',
      receiptHash: 'sha256:receipt-a',
      receipt: {
        jobId: 'peer_job_a',
        providerId: 'provider_page_nested'
      },
      agreement: { accepted: true }
    }, 'sha256:receipt-a');

    expect(storage.getItem(keysA.receipts)).toContain('provider_page_nested');
    expect(findReceiptLedgerRecord('sha256:receipt-a')?.jobId).toBe('peer_job_a');
    expect(renderReceiptLedger()).toContain('provider_page_nested');

    setRoom(roomB);
    expect(renderReceiptLedger()).toContain('No rounds logged yet.');
    expect(findReceiptLedgerRecord('sha256:receipt-a')).toBeNull();

    setRoom(roomA);
    expect(findReceiptLedgerRecord('sha256:receipt-a')?.receipt?.providerId).toBe('provider_page_nested');
  });

  it('renders peer ledger zero counts instead of blank cells', () => {
    const room = `record-ledger-${crypto.randomUUID()}`;
    setRoom(room);

    setResult('missing-result-element', {
      ledgerEvents: [
        {
          messageHash: 'points-provider-a',
          type: PEER_MESSAGE_TYPES.POINTS_EVENT,
          body: {
            userId: 'provider_page_a',
            providerId: 'provider_page_a',
            points: 1
          }
        },
        {
          messageHash: 'reputation-provider-a',
          type: PEER_MESSAGE_TYPES.REPUTATION_EVENT,
          body: {
            providerId: 'provider_page_a',
            acceptedReceipts: 1,
            rejectedReceipts: 0,
            points: 1
          }
        }
      ]
    });

    const html = renderPeerLedgerState();
    expect(html).toContain('provider_page_a');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('<td>0</td>');
  });

  it('uses a lookup-specific empty state on the record route', () => {
    setRoom(`record-copy-${crypto.randomUUID()}`);

    const html = renderRouteDetail('record');

    expect(html).toContain('No receipt lookup yet.');
    expect(html).toContain('No rounds logged yet.');
    expect(html).toContain('Room Activity');
    expect(html).toContain('Loading room activity...');
  });

  it('renders compact server relay room activity summaries', () => {
    setRoom(`record-activity-${crypto.randomUUID()}`);

    const html = renderRoomActivity({
      relay: 'server',
      messageCount: 3,
      peerCount: 2,
      providerCount: 1,
      recent: [
        { type: 'provider-advert', fromPeerId: 'provider_a' },
        { type: 'peer-run-request', fromPeerId: 'requester_a' }
      ]
    });

    expect(html).toContain('Server relay room activity');
    expect(html).toContain('<td>3</td>');
    expect(html).toContain('<td>2</td>');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('provider-advert:provider_a');
  });
});
