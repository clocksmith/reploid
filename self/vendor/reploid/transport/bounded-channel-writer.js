/** Serializes frame writes so concurrent requests share one buffer/byte budget. */
export function createBoundedChannelWriter({ channel, limits, signal, account }) {
  let tail = Promise.resolve();
  let sentBytes = 0;
  const encoder = new TextEncoder();

  function waitForSpace(size, requestSignal) {
    return new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        channel.removeEventListener('bufferedamountlow', low);
        signal.removeEventListener('abort', abort);
        requestSignal?.removeEventListener('abort', abort);
        error ? reject(error) : resolve();
      };
      const abort = () => finish(new Error('Partition channel write cancelled'));
      const low = () => {
        if (channel.bufferedAmount + size <= limits.maxBufferedBytes) finish();
      };
      const timer = setTimeout(() => finish(new Error('Partition channel backpressure timeout')), limits.timeoutMs);
      channel.addEventListener('bufferedamountlow', low);
      signal.addEventListener('abort', abort, { once: true });
      requestSignal?.addEventListener('abort', abort, { once: true });
      if (signal.aborted || requestSignal?.aborted) abort();
      else low();
    });
  }

  return function send(data, requestSignal) {
    const size = typeof data === 'string' ? encoder.encode(data).byteLength : data.byteLength;
    const operation = tail.then(async () => {
      signal.throwIfAborted();
      requestSignal?.throwIfAborted();
      if (channel.bufferedAmount + size > limits.maxBufferedBytes) await waitForSpace(size, requestSignal);
      signal.throwIfAborted();
      requestSignal?.throwIfAborted();
      if (channel.readyState !== 'open') throw new Error('Partition channel unavailable');
      if (sentBytes + size > limits.maxTransferBytes) throw new Error('Partition channel outgoing byte budget exhausted');
      channel.send(data);
      sentBytes += size;
      account(size);
    });
    tail = operation.catch(() => {});
    return operation;
  };
}
