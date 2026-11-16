// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { Readable, Writable } from 'node:stream';
import { serveCompleteRequestProtocol, COMPLETE_RESPONSE_PREFIX } from '../fixtures/complete-request-protocol.js';
it('serializes one matching complete response per invocation and closes on the explicit owner request', async () => {
  const rows = [], onClose = vi.fn();
  const output = new Writable({ write(bytes, encoding, done) { rows.push(bytes.toString()); setImmediate(done); } });
  await serveCompleteRequestProtocol({ input: Readable.from(['{"id":1,"op":"request"}\n{"id":2,"op":"close"}\n']), output, onClose,
    invoke: async request => ({ actualOp: request.op }) });
  expect(rows.map(line => JSON.parse(line.slice(COMPLETE_RESPONSE_PREFIX.length)))).toEqual([
    { id: 1, requestOp: 'request', value: { actualOp: 'request' } }, { id: 2, requestOp: 'close', value: { actualOp: 'close' } },
  ]);
  expect(onClose).not.toHaveBeenCalled();
});
it('keeps invocation failures explicit and settles the owner on EOF or response write failure', async () => {
  const rows = [], onClose = vi.fn();
  await serveCompleteRequestProtocol({ input: Readable.from(['{"id":3,"op":"request"}\n']), onClose,
    output: new Writable({ write(bytes, encoding, done) { rows.push(bytes.toString()); done(); } }),
    invoke() { throw new Error('request failed'); } });
  expect(JSON.parse(rows[0].slice(COMPLETE_RESPONSE_PREFIX.length))).toMatchObject({ id: 3, requestOp: 'request', error: { message: 'request failed' } });
  expect(onClose).toHaveBeenCalledOnce();
  const failedClose = vi.fn();
  const output = { write(bytes, callback) { callback(new Error('response closed')); } };
  await expect(serveCompleteRequestProtocol({ input: Readable.from(['{"id":1,"op":"request"}\n']), output,
    invoke: () => ({}), onClose: failedClose })).rejects.toThrow('response closed');
  expect(failedClose).toHaveBeenCalledOnce();
});
