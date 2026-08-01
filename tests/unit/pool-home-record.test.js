import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PEER_MESSAGE_TYPES } from '../../self/pool/peer-control-plane.js';
import {
  addReceiptLedgerRow,
  findReceiptLedgerRecord,
  getPooldayRecordStorageKeys,
  renderPeerLedgerState,
  renderRecordLedger,
  renderReceiptLedger,
  renderRoomActivity,
  renderRouteDetail,
  restoreLatestCompletedRun,
  setPoolRecordDisclosureOpen,
  setPoolRecordFacet,
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
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
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
    expect(renderRecordLedger()).toContain('Answer completed');

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

  it('labels points, reputation, and requester spend as distinct room records', () => {
    const room = `record-event-labels-${crypto.randomUUID()}`;
    setRoom(room);

    setResult('missing-result-element', {
      ledgerEvents: [
        {
          messageHash: 'points-provider-label',
          type: PEER_MESSAGE_TYPES.POINTS_EVENT,
          body: { userId: 'provider_page_a', points: 4, reason: 'accepted_receipt' }
        },
        {
          messageHash: 'reputation-provider-label',
          type: PEER_MESSAGE_TYPES.REPUTATION_EVENT,
          body: { providerId: 'provider_page_a', points: 4, reason: 'accepted_receipt' }
        },
        {
          messageHash: 'points-requester-label',
          type: PEER_MESSAGE_TYPES.POINTS_EVENT,
          body: { userId: 'requester_page_a', points: -4, reason: 'accepted_receipt_spend' }
        }
      ]
    });

    const html = renderRecordLedger('room');
    expect(html).toContain('Contributor points credited');
    expect(html).toContain('Contributor reputation updated');
    expect(html).toContain('Requester points spent');
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

  it('moves pooled embeddings out of raw results into the Protein embedding disclosure', () => {
    document.body.innerHTML = `
      <div id="pool-run-result-summary"></div>
      <pre id="pool-run-result-raw"></pre>
      <pre id="pool-run-result-stream"></pre>
      <span id="pool-run-result-stream-cursor"></span>
      <details id="pool-run-result-embedding-details" hidden><p id="pool-run-result-embedding-meta"></p><pre id="pool-run-result-embedding"></pre></details>
    `;

    setResult('pool-run-result', {
      sequenceResultHash: 'sha256:embedding-result',
      sequenceOutput: {
        pooledEmbedding: [0.25, -0.5, 0.75],
        tokenEmbeddings: null,
        maskedLogits: []
      }
    }, { stream: true, animate: false });

    expect(document.getElementById('pool-run-result-raw').textContent).not.toContain('0.25');
    expect(document.getElementById('pool-run-result-raw').textContent).toContain('Rendered in Protein embedding');
    expect(document.getElementById('pool-run-result-embedding-details').hidden).toBe(false);
    expect(document.getElementById('pool-run-result-embedding-meta').textContent).toContain('3 dimensions');
    expect(document.getElementById('pool-run-result-embedding').textContent).toContain('0.25');
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

  it('uses one records surface for saved answers, room activity, and contributor scores', () => {
    setRoom(`record-copy-${crypto.randomUUID()}`);

    const recordsHtml = renderRouteDetail('records');
    const historyAliasHtml = renderRouteDetail('history');
    const networkAliasHtml = renderRouteDetail('network');

    expect(recordsHtml).toContain('No lookup yet.');
    expect(recordsHtml).toContain('No answers saved yet.');
    expect(recordsHtml).toContain('No records yet. Completed runs and contributions will appear here.');
    expect(recordsHtml).toContain('Technical tools');
    expect(recordsHtml).toContain('Room activity');
    expect(recordsHtml).toContain('Checking room activity...');
    expect(recordsHtml).toContain('Contributor scores');
    expect(recordsHtml).toContain('No local scores yet.');
    expect(recordsHtml).toContain('Find by receipt hash');
    expect(historyAliasHtml).toContain('Contributor scores');
    expect(networkAliasHtml).toContain('Saved answer receipts');
    expect(networkAliasHtml).toContain('Room activity');
  });

  it('restores record facets and open disclosures after a route refresh', () => {
    const roomId = `record-view-${crypto.randomUUID()}`;
    setRoom(roomId);
    addReceiptLedgerRow({
      jobId: 'peer_job_open',
      receiptHash: 'sha256:receipt-open',
      receipt: {
        jobId: 'peer_job_open',
        providerId: 'provider_page_open'
      },
      agreement: { accepted: true }
    }, 'sha256:receipt-open');

    setPoolRecordFacet('answer');
    setPoolRecordDisclosureOpen('record:receipt:sha256:receipt-open', true);
    setPoolRecordDisclosureOpen('technical-tools', true);
    setPoolRecordDisclosureOpen('receipt-lookup', true);

    const html = renderRouteDetail('records');
    expect(html).toContain('data-record-facet="answer"');
    expect(html).toMatch(/data-pool-record-disclosure="record:receipt:sha256:receipt-open" open/);
    expect(html).toMatch(/data-pool-record-disclosure="technical-tools" open/);
    expect(html).toMatch(/data-pool-record-disclosure="receipt-lookup" open/);
  });

  it('restores the latest accepted result as saved history without implying a live run', () => {
    const roomId = `record-result-${crypto.randomUUID()}`;
    setRoom(roomId);
    document.body.innerHTML = `
      <section data-pool-run-surface data-run-state="idle">
        <p data-pool-run-status>Ready</p>
        <section data-pool-run-output hidden>
          <div id="pool-run-result-summary"></div>
          <pre id="pool-run-result-stream"></pre>
          <span id="pool-run-result-stream-cursor"></span>
          <div id="pool-run-result-evidence"></div>
          <div id="pool-run-result-recovery"></div>
          <pre id="pool-run-result-raw"></pre>
        </section>
      </section>
    `;
    addReceiptLedgerRow({
      outputText: 'persisted accepted answer',
      receiptHash: 'sha256:persisted',
      receipt: {
        jobId: 'peer_job_persisted',
        providerId: 'provider_page_persisted'
      },
      requesterAcceptance: { accepted: true },
      agreement: { accepted: true }
    }, 'sha256:persisted');

    const restored = restoreLatestCompletedRun('ask');

    expect(restored?.savedRecord).toMatchObject({ restored: true, roomId });
    expect(document.getElementById('pool-run-result-stream').textContent).toBe('persisted accepted answer');
    expect(document.querySelector('[data-pool-run-output]').hidden).toBe(false);
    expect(document.querySelector('[data-pool-run-status]').textContent).toBe('Showing last saved answer');
    expect(document.querySelector('[data-pool-run-surface]').dataset.runState).toBe('inspecting');
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
