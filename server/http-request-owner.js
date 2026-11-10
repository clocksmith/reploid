/** HTTP lifetime only. Callers retain protocol, authorization and settlement policy. */
export function createHttpRequestOwner({ timeoutMs }) {
  const active = new Set();
  let closed = false;
  return {
    get closed() { return closed; },
    get size() { return active.size; },
    begin(req, res, { disconnectError, deadlineError, onFinish = () => {} }) {
      if (closed) throw new Error('HTTP request owner is closed');
      const controller = new AbortController();
      let resolve;
      const item = { controller, completion: new Promise(done => { resolve = done; }) };
      active.add(item);
      let finished = false;
      const socket = req.socket ?? null;
      const cancel = () => {
        if (!finished && !res.writableEnded) controller.abort(disconnectError());
      };
      req.once('aborted', cancel);
      res.once('close', cancel);
      socket?.once('close', cancel);
      const timer = setTimeout(() => controller.abort(deadlineError()), timeoutMs);
      return {
        controller, signal: controller.signal, item,
        clearDeadline() { clearTimeout(timer); },
        finish() {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          req.removeListener('aborted', cancel);
          res.removeListener('close', cancel);
          socket?.removeListener('close', cancel);
          active.delete(item);
          try { onFinish(item); } finally { resolve(); }
        }
      };
    },
    async close(reason, unsettledError) {
      closed = true;
      for (const item of active) item.controller.abort(reason());
      let timer;
      try {
        await Promise.race([Promise.all([...active].map(item => item.completion)), new Promise((_, reject) => {
          timer = setTimeout(() => reject(unsettledError()), timeoutMs);
        })]);
      } finally { clearTimeout(timer); }
    }
  };
}
