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
    expect(renderReceiptLedger()).toContain('No answers saved yet.');
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

  it('serializes repeated result objects without losing arrays as circular values', () => {
    document.body.innerHTML = `
      <div id="pool-run-result-summary"></div>
      <pre id="pool-run-result-raw"></pre>
      <pre id="pool-run-result-stream"></pre>
      <span id="pool-run-result-stream-cursor"></span>
    `;
    const assignments = [{ providerId: 'provider_a' }, { providerId: 'provider_b' }];
    const repeated = assignments[0];
    repeated.self = repeated;

    setResult('pool-run-result', {
      assignments,
      firstAssignment: repeated
    }, { stream: true });

    const parsed = JSON.parse(document.getElementById('pool-run-result-raw').textContent);
    expect(parsed.assignments).toHaveLength(2);
    expect(parsed.assignments[0].providerId).toBe('provider_a');
    expect(parsed.assignments[0].self).toBe('[Circular]');
    expect(parsed.firstAssignment.providerId).toBe('provider_a');
  });

  it('renders clean answer contributors while preserving the full result', () => {
    document.body.innerHTML = `
      <div id="pool-run-result-summary"></div>
      <div id="pool-run-result-evidence"></div>
      <pre id="pool-run-result-raw"></pre>
      <pre id="pool-run-result-stream"></pre>
      <span id="pool-run-result-stream-cursor"></span>
    `;

    setResult('pool-run-result', {
      outputText: 'distributed answer',
      policyId: 'ring_quorum_receipt',
      agreement: {
        accepted: true,
        requiredAgreement: 2,
        acceptedProviderCount: 2,
        receiptHashes: ['sha256:a', 'sha256:b']
      },
      receiptPayloads: [
        {
          fromPeerId: 'provider_a',
          body: {
            receiptHash: 'sha256:a',
            providerId: 'provider_a',
            tokenIds: [1, 2],
            receipt: {
              providerId: 'provider_a',
              outputHash: 'sha256:output-a',
              tokenCounts: { input: 3, output: 2 }
            }
          }
        },
        {
          fromPeerId: 'provider_b',
          body: {
            receiptHash: 'sha256:b',
            providerId: 'provider_b',
            tokenIds: [1, 2],
            receipt: {
              providerId: 'provider_b',
              outputHash: 'sha256:output-b',
              tokenCounts: { input: 3, output: 2 }
            }
          }
        }
      ]
    }, { stream: true });

    expect(document.getElementById('pool-run-result-stream').textContent).toBe('distributed answer');
    expect(document.getElementById('pool-run-result-evidence').textContent).toContain('provider_a');
    expect(document.getElementById('pool-run-result-evidence').textContent).toContain('matched');
    expect(JSON.parse(document.getElementById('pool-run-result-raw').textContent).receiptPayloads).toHaveLength(2);
  });

  it('uses split empty states on the history and network routes', () => {
    setRoom(`record-copy-${crypto.randomUUID()}`);

    const historyHtml = renderRouteDetail('history');
    const networkHtml = renderRouteDetail('network');

    expect(historyHtml).toContain('No lookup yet.');
    expect(historyHtml).toContain('No answers saved yet.');
    expect(historyHtml).toContain('Room activity');
    expect(historyHtml).toContain('Checking room activity...');
    expect(historyHtml).toContain('Find saved answer by hash');
    expect(historyHtml).not.toContain('Local scores');
    expect(networkHtml).toContain('Network health');
    expect(networkHtml).toContain('Seen by this browser');
    expect(networkHtml).toContain('No local scores yet.');
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

    expect(html).toContain('Shared room activity');
    expect(html).toContain('<td>3</td>');
    expect(html).toContain('<td>2</td>');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('provider-advert:provider_a');
  });
});
