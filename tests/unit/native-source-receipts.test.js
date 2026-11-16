// @vitest-environment node
import { expect, it } from 'vitest';
import { collectNativeSourceReceipts, collectClosedNativeSourceReceipts } from '../fixtures/native-source-receipts.js';

it('separates pre-close gather diagnostics from final generic counters and propagates final failures', async () => {
  let closed = false;
  const source = { getReceipt: () => ({ activeReadBytes: closed ? 0 : 4 }),
    getGatherReceipt: () => { if (closed) throw new Error('worker closed'); return { activeReadBytes: 0 }; } };
  expect((await collectNativeSourceReceipts([source]))[0].gather.activeReadBytes).toBe(0);
  closed = true;
  expect(collectClosedNativeSourceReceipts([source])).toEqual([{ sourceIndex: 0, generic: { activeReadBytes: 0 } }]);
  expect((await collectNativeSourceReceipts([source]))[0].receiptFailure).toContain('worker closed');
  source.getReceipt = () => { throw new Error('final receipt failed'); };
  expect(() => collectClosedNativeSourceReceipts([source])).toThrow('final receipt failed');
});
