// A quote that promises the first output by a time stops a charged attempt that produced none by then, and
// reports it as stopped at that quoted deadline; the first output cancels that timer. The earning client is
// a recording double; the route is a stand-in for the ordered requester port.
import { describe, expect, it } from 'vitest';

import { createEarningAttempts } from '../../self/host/earning/attempts.js';

const storage = () => {
  const map = new Map();
  return { get: async (key) => structuredClone(map.get(key) ?? null), set: async (key, value) => { map.set(key, structuredClone(value)); }, delete: async (key) => { map.delete(key); } };
};

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const quote = { quoteId: 'quote_1', quoteHash: 'h', pricing: { maxCharge: 60 },
  service: { deadline: new Date(NOW + 180_000).toISOString(), firstOutputDeadline: new Date(NOW + 30_000).toISOString() },
  terms: { execution: { maxAttempts: 2 } } };

const harness = () => {
  const sent = [];
  const timers = [];
  const client = {
    participantId: 'peer_requester', storage: storage(),
    async send(op) {
      sent.push(op);
      if (op.path === '/quotes') return structuredClone(quote);
      if (op.path.endsWith('/accept')) return { reservationId: 'rsv_1', authorizedMax: 60 };
      if (op.path.endsWith('/attempts')) return { bound: true };
      return { reservationStatus: 'settled', closed: true };
    }
  };
  const attempts = createEarningAttempts({ client, now: () => NOW, quoteRequest: () => ({}), authorizeSpending: async () => true,
    setTimer: (callback, ms) => { const timer = { callback, ms, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; } });
  return { sent, timers, attempts };
};

const route = { schema: 'reploid.partition-route/v1', stages: [{ participantId: 'peer_a' }, { participantId: 'peer_b' }] };
const request = { threadId: 't1', attemptId: 'a1', model: { id: 'm', identity: 'sha256:m', partition: { schema: 'reploid.partition-selection/v2', route } }, messages: [] };
const approve = async (controls) => controls.requestApproval({ route, input: { recipients: ['peer_a', 'peer_b'] } });

describe('first-output deadline', () => {
  it('stops an attempt with no output by the quoted first-output deadline and reports it at that deadline', async () => {
    const { sent, timers, attempts } = harness();
    const running = attempts.run(request, { requestApproval: async () => true }, async (_request, controls) => {
      await approve(controls);
      await new Promise((resolve, reject) => controls.signal.addEventListener('abort', () => reject(controls.signal.reason), { once: true }));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(timers.map((timer) => timer.ms)).toEqual([180_000, 30_000]);
    timers[1].callback();
    await expect(running).rejects.toMatchObject({ code: 'QUOTE_FIRST_OUTPUT_DEADLINE' });
    expect(sent.at(-1)).toMatchObject({ path: '/reservations/rsv_1/reports', body: { report: { result: 'cancelled', cancellation: { cause: 'deadline' } } } });
    expect(timers.every((timer) => timer.cancelled)).toBe(true);
  });

  it('cancels the first-output timer at the first output and completes normally', async () => {
    const { sent, timers, attempts } = harness();
    const deltas = [];
    const result = await attempts.run(request, { requestApproval: async () => true, onDelta: (envelope) => deltas.push(envelope.text) }, async (_request, controls) => {
      await approve(controls);
      expect(timers[1].cancelled).toBe(false);
      controls.onDelta({ text: 'first' });
      expect(timers[1].cancelled).toBe(true);
      return { content: 'first', execution: { identity: { attemptId: 'a1' } } };
    });
    expect(result.content).toBe('first');
    expect(deltas).toEqual(['first']);
    expect(sent.at(-1)).toMatchObject({ body: { report: { result: 'completed' } } });
  });
});
