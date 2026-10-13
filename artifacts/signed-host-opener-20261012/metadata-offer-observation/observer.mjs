/** Diagnostic only: bounded main-channel metadata timing, never payload/key logging. */
export function attachNativeCustodyObservation(transport, handlers, peers) {
  const key = 'reploid:custody-request', originalHandler = handlers.get(key), originalSend = transport.sendToPeer;
  if (typeof originalHandler !== 'function' || typeof originalSend !== 'function') throw new Error('Custody observation ports missing');
  const records = [], startedAt = Date.now();
  let stopped = false, previous = Date.now(), maxLoopDelayMs = 0, samples = 0;
  const record = item => { records.push({ at: Date.now(), ...item }); if (records.length > 128) records.shift(); };
  const channel = peer => { const c = peers.get(peer)?.dataChannel; return c ? {
    readyState: c.readyState, bufferedAmount: c.bufferedAmount,
    ordered: c.ordered, maxRetransmits: c.maxRetransmits, maxPacketLifeTime: c.maxPacketLifeTime
  } : null; };
  const select = (peer, message) => ({ peer, id: typeof message?.id === 'string' ? message.id.slice(0, 128) : null,
    path: typeof message?.artifact?.path === 'string' ? message.artifact.path.slice(0, 256) : null,
    sizeBytes: message?.artifact?.sizeBytes, rangeOffset: message?.range?.offset, rangeSize: message?.range?.size,
    channelRequest: message?.channel === true, release: typeof message?.release === 'string', channel: channel(peer) });
  function handler(peer, message, ...rest) {
    record({ event: 'request', ...select(peer, message) });
    try { return Reflect.apply(originalHandler, this, [peer, message, ...rest]); }
    catch (error) { record({ event: 'request-throw', id: message?.id, error: String(error.message).slice(0, 256) }); throw error; }
  }
  function send(peer, type, message, ...rest) {
    const observed = type === 'reploid:custody-response' || type === 'reploid:custody-request';
    const details = observed ? select(peer, message) : null;
    try {
      const result = Reflect.apply(originalSend, this, [peer, type, message, ...rest]);
      if (observed) record({ event: 'send', type, ...details, result,
        error: typeof message?.error === 'string' ? message.error.slice(0, 256) : null });
      return result;
    } catch (error) { if (observed) record({ event: 'send-throw', type, ...details, error: String(error.message).slice(0, 256) }); throw error; }
  }
  transport.sendToPeer = send;
  handlers.set(key, handler);
  const sample = setInterval(() => {
    const now = Date.now(), delay = Math.max(0, now - previous - 250); previous = now;
    samples++; maxLoopDelayMs = Math.max(maxLoopDelayMs, delay);
    if (delay > 100) record({ event: 'loop-delay', delayMs: delay });
  }, 250);
  const stop = () => {
    if (stopped) return;
    stopped = true; clearInterval(sample); clearTimeout(deadline);
    if (transport.sendToPeer === send) transport.sendToPeer = originalSend;
    if (handlers.get(key) === handler) handlers.set(key, originalHandler);
    record({ event: 'stopped' });
  };
  const deadline = setTimeout(stop, 300000);
  return { stop, snapshot: () => ({ scope: 'Diagnostic request/send-return and event-loop observation; no delivery guarantee',
    startedAt, observedAt: Date.now(), stopped, limitMs: 300000, maxRecords: 128, samples, maxLoopDelayMs,
    channels: [...peers.keys()].map(peer => ({ peer, ...channel(peer) })), records: structuredClone(records) }) };
}
