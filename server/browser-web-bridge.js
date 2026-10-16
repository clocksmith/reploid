/** Attach an operator-approved public-web worker to exactly one Playwright-owned page.
 * Other tabs and frames get no bridge. Public reads use the native guarded worker,
 * not the contributor's cookies or personal browser profile. */
import { createPublicWebWorker } from './public-web-worker.js';
import policy from '../packages/reploid/src/mesh/web-access-policy.json' with { type: 'json' };

export async function attachBrowserWebBridge({ page, origin, worker = createPublicWebWorker() }) {
  const pending = new Map();
  let closed = false;
  const binding = `reploidWeb_${crypto.randomUUID().replaceAll('-', '')}`;
  const close = () => {
    closed = true;
    for (const controller of pending.values()) controller.abort(new Error('Browser web bridge closed'));
  };
  await page.exposeBinding(binding, async ({ frame }, message) => {
    if (closed || frame !== page.mainFrame() || new URL(frame.url()).origin !== origin) throw new Error('Browser bridge is not authorized here');
    if (!message || typeof message.id !== 'string' || message.id.length > 128) throw new Error('Invalid bridge request');
    if (message.operation === 'cancel') { pending.get(message.id)?.abort(new Error('Browser request cancelled')); return null; }
    if (!['search', 'extract'].includes(message.operation) || pending.has(message.id) || pending.size >= policy.maxInbound
      || new TextEncoder().encode(JSON.stringify(message)).length > policy.maxMessageBytes) throw new Error('Browser web request exceeds limits');
    if (typeof message.requester !== 'string' || message.requester.length > 256) throw new Error('Missing requester identity');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('Browser web request timed out')), policy.timeoutMs);
    pending.set(message.id, controller);
    try {
      const result = await worker[message.operation](message.args, { requester: message.requester, signal: controller.signal });
      controller.signal.throwIfAborted();
      return result;
    } finally { clearTimeout(timer); pending.delete(message.id); }
  });
  await page.addInitScript(({ binding, origin }) => {
    if (location.origin !== origin || window !== window.top) return;
    const request = async (operation, args, { signal, requester }) => {
      signal?.throwIfAborted();
      const id = crypto.randomUUID();
      const abort = () => { void globalThis[binding]({ id, operation: 'cancel' }).catch(() => {}); };
      signal?.addEventListener('abort', abort, { once: true });
      try {
        const result = await globalThis[binding]({ id, operation, args, requester });
        signal?.throwIfAborted(); return result;
      } finally { signal?.removeEventListener('abort', abort); }
    };
    Object.defineProperty(globalThis, 'REPLOID_WEB_CONTRIBUTION', { value: Object.freeze({
      service: 'bing', version: '1', search: (args, controls) => request('search', args, controls),
      extract: (args, controls) => request('extract', args, controls)
    }) });
  }, { binding, origin });
  page.on('close', close);
  // Navigation retires every in-flight request. The new approved document gets a fresh facade.
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) for (const controller of pending.values()) controller.abort(new Error('Browser navigated')); });
  return Object.freeze({ close });
}
