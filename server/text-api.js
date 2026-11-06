/** One authenticated HTTP surface over a borrowed requester. Production execution
 * must be wrapped by the accounting owner; test execution is explicitly unbilled. */
import { createChatCompletions } from './chat-completions.js';
import { createResponses } from './responses.js';
import { createTextRecovery, TEXT_RECOVERY_PATH } from './text-recovery.js';
import { partitionAdapterIdentities } from '../packages/reploid/src/mesh/partitions/partition-contract.js';
import policy from '../apps/poolday/config/partition-policy.json' with { type: 'json' };

export const TEXT_API_PATHS = Object.freeze(['/v1/chat/completions', '/v1/responses', '/v1/models', TEXT_RECOVERY_PATH]);
export function createTextApi({ participant, authenticate, authorize, accounting, production = true, allowUnbilledTest = false }) {
  if (!participant || typeof authenticate !== 'function' || typeof authorize !== 'function') throw Error('Text API requires requester authentication and authorization');
  if (typeof accounting?.run !== 'function' && (production || !allowUnbilledTest)) throw Error('Text API requires accounted execution; unbilled tests must be explicit');
  if (accounting && typeof accounting.run !== 'function') throw Error('Invalid text API accounting port');
  const requester = accounting ? { ...participant, getState: () => participant.getState(),
    generate: (request, controls) => accounting.run(request, controls,
      (nextRequest = request, nextControls = controls) => participant.generate(nextRequest, nextControls)) } : participant;
  const options = { participant: requester, authenticate, authorize };
  const completions = createChatCompletions(options), responses = createResponses(options);
  const recovery = createTextRecovery({ participant, authenticate, authorize, accounting });
  const listing = new Set(); let closed = false;
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  return Object.freeze({
    async handle(req, res) {
      let path;
      try { path = new URL(req.url || '/', 'http://localhost').pathname; }
      catch { return json(res, 400, { error: { message: 'Invalid API route' } }); }
      if (path === '/v1/chat/completions') return completions.handle(req, res);
      if (path === '/v1/responses') return responses.handle(req, res);
      if (path === TEXT_RECOVERY_PATH) return recovery.handle(req, res);
      if (path !== '/v1/models') return json(res, 404, { error: { message: 'Unsupported API route' } });
      if (closed) return json(res, 503, { error: { message: 'Text API is closed' } });
      if (listing.size >= policy.inputLimits.maxConcurrentAttempts) return json(res, 429, { error: { message: 'Model listing admission unavailable' } });
      if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }); res.end(); return; }
      const controller = new AbortController(), { signal } = controller;
      listing.add(controller);
      const cancel = () => controller.abort(Error('Model listing disconnected'));
      const timer = setTimeout(() => controller.abort(Error('Model listing deadline exceeded')), policy.controlChannel.timeoutMs);
      req.once('aborted', cancel); res.once('close', cancel);
      try {
        const principal = await authenticate(req, { signal }); signal.throwIfAborted();
        if (typeof principal?.subject !== 'string' || !principal.subject || principal.subject.length > 512) return json(res, 401, { error: { message: 'Authentication required' } });
        if (await authorize({ action: 'models.list', principal: Object.freeze({ subject: principal.subject }), signal }) !== true) {
          return json(res, 403, { error: { message: 'Model listing denied' } });
        }
        signal.throwIfAborted();
        const rows = (requester.getState().models || []).filter(model => !model.canonical
          && (model.partition || model.availability === 'ready' && model.providerIds?.length));
        const variants = new Map();
        for (const model of rows) {
          const value = { id: model.selectionId || model.id, object: 'model', owned_by: 'reploid',
            model_identity: model.identity, adapter_identities: partitionAdapterIdentities(model) };
          if (variants.has(value.id) && JSON.stringify(variants.get(value.id)) !== JSON.stringify(value)) {
            return json(res, 409, { error: { message: 'Model id has ambiguous execution identity' } });
          }
          variants.set(value.id, value);
        }
        json(res, 200, { object: 'list', data: [...variants.values()] });
      } catch (error) {
        if (!res.destroyed && !res.writableEnded) json(res, 503, { error: { message: error.message } });
      } finally { clearTimeout(timer); listing.delete(controller); req.removeListener('aborted', cancel); res.removeListener('close', cancel); }
    },
    async close() {
      closed = true;
      for (const controller of listing) controller.abort(Error('Text API closing'));
      await Promise.all([completions.close(), responses.close(), recovery.close()]);
    }
  });
}
