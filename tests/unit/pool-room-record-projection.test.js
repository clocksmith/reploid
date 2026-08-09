import { describe, expect, it } from 'vitest';

import { projectRoomRecordRows } from '../../self/ui/pool-home/room-record-projection.js';

describe('Research Room record projection', () => {
  it('combines receipt, contribution, peer, and room activity without mutating inputs', () => {
    const receipts = [{
      receiptHash: 'sha256:receipt',
      occurredAt: '2026-08-09T10:00:00.000Z',
      fidelity: 'accepted',
      provider: 'provider-room',
      record: { receiptHash: 'sha256:receipt', requesterAcceptance: { accepted: true } }
    }];
    const contributions = [{
      receiptHash: 'sha256:contribution',
      completedAt: '2026-08-09T10:01:00.000Z',
      tokens: 1200,
      modelId: 'esm2-t12-35m-ur50d-f32-af32'
    }];
    const peerEvents = [{
      messageHash: 'sha256:event',
      type: 'points_event',
      createdAt: '2026-08-09T10:02:00.000Z',
      body: { providerId: 'provider-room', points: 2, reason: 'accepted_receipt' }
    }];
    const summary = {
      roomId: 'room-records',
      messageCount: 1,
      peerCount: 2,
      providerCount: 1,
      recent: [{ createdAt: '2026-08-09T10:03:00.000Z' }]
    };

    const rows = projectRoomRecordRows({ receipts, contributions, peerEvents, roomActivitySummary: summary });

    expect(rows.map((row) => row.type)).toEqual(['room', 'room', 'contribution', 'answer']);
    expect(rows[2]).toMatchObject({ title: 'Contribution made', meta: expect.stringContaining('1.2k tokens') });
    expect(rows[3]).toMatchObject({ title: 'Answer completed', meta: expect.stringContaining('accepted') });
    expect(receipts).toHaveLength(1);
    expect(contributions).toHaveLength(1);
    expect(peerEvents).toHaveLength(1);
  });
});
