import { describe, expect, it } from 'vitest';

import { projectRoomRecordRows } from '../../self/ui/pool-home/room-record-projection.js';

describe('Poolday room record projection', () => {
  it('retains an unmatched model request as a recoverable request record', () => {
    const occurredAt = '2026-08-30T20:00:00.000Z';
    const rows = projectRoomRecordRows({
      peerEvents: [{
        type: 'request_event',
        fromPeerId: 'requester-a',
        createdAt: occurredAt,
        body: {
          status: 'waiting_for_provider',
          reason: 'No matching provider',
          modelId: 'esm2-t12-35m-ur50d',
          retryable: true
        }
      }]
    });

    expect(rows).toEqual([expect.objectContaining({
      type: 'request',
      occurredAt,
      title: 'Request waiting for provider',
      meta: expect.stringContaining('No matching provider')
    })]);
    expect(rows[0].detail.body.retryable).toBe(true);
  });
});
