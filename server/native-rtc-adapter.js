

/** node-webrtc exposes UINT16_MAX for unspecified SCTP retransmission limits.
 * Normalize that provider representation at the host boundary, not in the
 * shared protocol's reliable-channel requirement. */
export function normalizeNativeDataChannel(channel) {
  for (const key of ['maxRetransmits', 'maxPacketLifeTime']) {
    if (channel[key] === 65535) Object.defineProperty(channel, key, { value: null, configurable: true });
  }
  normalizeNativeDrainEvents(channel);
  return channel;
}

/** wrtc 0.10 exposes bufferedAmount but no threshold or low-water event.
 * Poll only for an active drain waiter; protocol timeouts/cancellation remove
 * that waiter. Providers with the standard contract retain their own events. */
export function normalizeNativeDrainEvents(channel) {
  if ('bufferedAmountLowThreshold' in channel || typeof channel.addEventListener !== 'function') return;
  const add = channel.addEventListener.bind(channel), remove = channel.removeEventListener.bind(channel);
  const send = channel.send.bind(channel);
  const waiters = new Map();
  let timer = null, previous = channel.bufferedAmount;
  Object.defineProperty(channel, 'bufferedAmountLowThreshold', { value: 0, writable: true, configurable: true });
  function stopTimer() { clearTimeout(timer); timer = null; }
  function removeWaiter(listener) {
    const entry = waiters.get(listener);
    if (!entry) return;
    waiters.delete(listener);
    remove('bufferedamountlow', entry.wrapper);
    entry.signal?.removeEventListener('abort', entry.abort);
    if (!waiters.size) stopTimer();
  }
  function schedule() {
    if (timer === null && waiters.size && channel.readyState === 'open') timer = setTimeout(poll, 16);
  }
  function poll() {
    timer = null;
    if (!waiters.size) return;
    if (channel.readyState !== 'open') { dispose(); return; }
    const current = channel.bufferedAmount;
    const crossed = previous > channel.bufferedAmountLowThreshold && current <= channel.bufferedAmountLowThreshold;
    previous = current;
    if (crossed) channel.dispatchEvent(new Event('bufferedamountlow'));
    if (current > channel.bufferedAmountLowThreshold) schedule();
  }
  function dispose() { stopTimer(); for (const listener of waiters.keys()) removeWaiter(listener); }
  channel.addEventListener = function(type, listener, options) {
    if (type !== 'bufferedamountlow') return add(type, listener, options);
    if (!listener || waiters.has(listener) || options?.signal?.aborted) return;
    const entry = { signal: options?.signal, abort: () => removeWaiter(listener), wrapper(event) {
      if (options?.once) removeWaiter(listener);
      if (typeof listener === 'function') listener.call(channel, event); else listener.handleEvent(event);
    } };
    waiters.set(listener, entry);
    add(type, entry.wrapper);
    entry.signal?.addEventListener('abort', entry.abort, { once: true });
    previous = channel.bufferedAmount;
    schedule();
  };
  channel.removeEventListener = function(type, listener, options) {
    if (type === 'bufferedamountlow') removeWaiter(listener); else remove(type, listener, options);
  };
  channel.send = function(...args) {
    const result = send(...args);
    if (channel.bufferedAmount > channel.bufferedAmountLowThreshold) { previous = channel.bufferedAmount; schedule(); }
    return result;
  };
  add('close', dispose); add('error', dispose);
}

export function createNativeRtcAdapter(rtc) {
  class RTCPeerConnection extends rtc.RTCPeerConnection {
    constructor(...args) {
      super(...args);
      this.addEventListener('datachannel', event => normalizeNativeDataChannel(event.channel));
    }
    createDataChannel(...args) { return normalizeNativeDataChannel(super.createDataChannel(...args)); }
  }
  return { ...rtc, RTCPeerConnection };
}
