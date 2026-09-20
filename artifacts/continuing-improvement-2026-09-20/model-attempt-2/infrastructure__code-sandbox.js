/** Execute pure candidate functions in a disposable worker inside an opaque-origin frame.
 * CSP denies network and loading; the host owns timeout and compares results outside the frame.
 * The worker receives one input, never the suite, expected answers, storage, or authority ports.
 */
const workerHarness = `onmessage = async ({data}) => {
  const send = postMessage.bind(self);
  try {
    const fn = new Function('"use strict"; return (' + data.code + ');')();
    const value = await fn(data.input);
    send({ok:true, value});
  } catch(error) { send({ok:false, candidateException:true, error:String(error?.message || error)}); }
};`;
const frameHarness = `addEventListener('message', event => {
  if(event.source !== parent || !event.ports[0]) return;
  const port = event.ports[0];
  const url = URL.createObjectURL(new Blob([${JSON.stringify(workerHarness)}], {type:'text/javascript'}));
  const worker = new Worker(url);
  worker.onmessage = ({data}) => { worker.terminate(); URL.revokeObjectURL(url); port.postMessage(data); port.close(); };
  worker.onerror = event => { worker.terminate(); URL.revokeObjectURL(url); port.postMessage({ok:false,error:event.message}); port.close(); };
  worker.postMessage(event.data);
}, {once:true});`;

export function runIsolatedCode(code, input, { signal, timeoutMs, maxResultBytes }) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true; frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    const channel = new MessageChannel();
    let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', aborted);
      channel.port1.close(); channel.port2.close(); frame.remove();
      if (error) reject(error); else resolve(value);
    };
    const aborted = () => finish(signal.reason || new Error('Code execution cancelled'));
    const timer = setTimeout(() => finish(new Error('Code execution exceeded its time limit')), timeoutMs);
    signal?.addEventListener('abort', aborted, { once: true });
    channel.port1.onmessage = ({ data }) => {
      try {
        if (!data?.ok) {
          const error = new Error(data?.error || 'Candidate execution failed');
          error.candidateException = data?.candidateException === true;
          throw error;
        }
        const serialized = JSON.stringify(data.value);
        if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > maxResultBytes) {
          throw new Error('Code result exceeds its limit or is not JSON');
        }
        finish(null, JSON.parse(serialized));
      } catch (error) { finish(error); }
    };
    frame.onload = () => {
      try { frame.contentWindow.postMessage({ code, input }, '*', [channel.port2]); }
      catch (error) { finish(error); }
    };
    frame.srcdoc = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' \'unsafe-eval\' blob:; worker-src blob:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'"><script>'
      + frameHarness + '<' + '/script>';
    document.body.append(frame);
    if (signal?.aborted) aborted();
  });
}

export function verifyCandidateCode(code, timeoutMs, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const finish = (error, value) => {
      clearTimeout(timer); signal?.removeEventListener('abort', aborted); worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    const aborted = () => finish(signal.reason || new Error('Verification cancelled'));
    const timer = setTimeout(() => finish(new Error('Verification timed out')), timeoutMs);
    worker.onmessage = ({ data }) => finish(null, data);
    worker.onerror = event => finish(new Error(event.message));
    signal?.addEventListener('abort', aborted, { once: true });
    worker.postMessage({ type: 'VERIFY', snapshot: { '/tools/candidate.js': 'export default (' + code + ');' } });
  });
}
