import { availablePartitionRoute, currentPartitionRoute, matchesPartitionDisclosure } from '../apps/poolday/host/partition-release.js';
/** One authenticated HTTP surface over a borrowed requester. Production execution
 * must be wrapped by the accounting owner; test execution is explicitly unbilled. */
import { createChatCompletions } from './chat-completions.js';
import { createResponses } from './responses.js';
import { createMessages } from './messages.js';
import { createTextRecovery, TEXT_RECOVERY_PATH } from './text-recovery.js';
import { canonicalPartitionJson, partitionAdapterIdentities } from '../shared/vendor/reploid/mesh/partitions/partition-contract.js';
import { createExecutionPolicy, assertAvailableExecutionPolicy } from '../shared/vendor/reploid/chat/execution-policy.js';
import policy from '../apps/poolday/config/partition-policy.json' with { type: 'json' };

export const TEXT_API_PATHS = Object.freeze(['/v1/chat/completions', '/v1/responses', '/v1/messages', '/v1/models', TEXT_RECOVERY_PATH]);
export function createTextApi({ participant, authenticate, authorize, accounting, production = true, allowUnbilledTest = false, statelessPrefixCache = undefined, privatePartitionApprovals, executionPolicyFor = null }) {
  if (!participant || typeof authenticate !== 'function' || typeof authorize !== 'function') throw Error('Text API requires requester authentication and authorization');
  if (typeof accounting?.run !== 'function' && (production || !allowUnbilledTest)) throw Error('Text API requires accounted execution; unbilled tests must be explicit');
  if (executionPolicyFor !== null && typeof executionPolicyFor !== 'function') throw Error('Invalid text API execution policy port');
  if (production && executionPolicyFor === null) throw Error('Production text API requires an explicit operator execution policy port');
  if (accounting && typeof accounting.run !== 'function') throw Error('Invalid text API accounting port');
  if (privatePartitionApprovals !== undefined && (participant.executionClass !== 'private-pool'
    || !Array.isArray(privatePartitionApprovals) || typeof accounting?.run !== 'function')) {
    throw Error('Private partition approvals require an accounted private fleet');
  }
  // Operator configuration is held for this API instance. Discovery and HTTP requests cannot extend it.
  const approvals = structuredClone(privatePartitionApprovals);
  const assertRoute = request => {
    if (request.model.partition && !currentPartitionRoute(request.model, participant.getState().models || [], approvals)) {
      throw Object.assign(Error('Selected distributed route is unavailable or not qualified for this API'), { status: 503 });
    }
  };
  const execute = (request, controls) => { assertRoute(request); return participant.generate(request, controls); };
  const requester = { ...participant,
    /**
     * The inference plan's charge ceiling. Unbilled test execution (no accounting) has no charge path and is free; an
     * accounting owner states its own cap, and one that cannot is refused before anything is planned.
     */
    async chargeCeiling(request, controls) {
      if (!accounting) return { kind: 'free' };
      return typeof accounting.chargeCeiling === 'function' ? accounting.chargeCeiling(structuredClone(request), controls) : null;
    },
    getState() {
      const state = participant.getState();
      return { ...state, models: (state.models || []).filter(model => !model.partition || availablePartitionRoute(model, approvals)) };
    },
    async generate(request, controls) {
      assertRoute(request);
      // The operator's policy bounds every request. The caller's requirements arrive compiled by the inference
      // API (the standard ones when the body has no extension) and may only narrow it, never widen it.
      const operator = assertAvailableExecutionPolicy(executionPolicyFor === null ? createExecutionPolicy()
        : await executionPolicyFor(structuredClone(request), controls));
      const caller = assertAvailableExecutionPolicy(request.privacy);
      // The caller's metadata allowance always narrows the operator's, whatever the placement.
      let privacy = assertAvailableExecutionPolicy({ ...operator, leakage: operator.leakage.filter(item => caller.leakage.includes(item)) });
      if (operator.placement !== 'network-allowed' && caller.recipients.kind === 'named') {
        throw Object.assign(Error('Network execution is not authorized by this API operator'), { status: 403 });
      }
      if (operator.placement === 'network-allowed') {
        if (caller.placement !== 'network-allowed') throw Object.assign(Error('This API runs requests on network participants only'), { status: 403 });
        const allowed = operator.recipients.kind === 'open' ? null : operator.recipients.ids;
        const ids = caller.recipients.kind === 'open' ? allowed : caller.recipients.ids.filter(id => !allowed || allowed.includes(id));
        if (ids !== null && !ids.length) throw Object.assign(Error('Requested participants are not authorized by this API operator'), { status: 403 });
        privacy = assertAvailableExecutionPolicy({ ...privacy, recipients: ids === null ? operator.recipients : { kind: 'named', ids } });
      }
      controls.signal.throwIfAborted();
      request = { ...request, privacy };
      return accounting ? accounting.run(request, controls, (nextRequest = request, nextControls = controls) => execute(nextRequest, nextControls))
        : execute(request, controls);
    }
  };
  const options = { participant: requester, authenticate,
    async authorize(check) {
      if (check.action === 'chat.disclose' && check.request.model.partition) {
        assertRoute(check.request);
        if (!matchesPartitionDisclosure(check.request.model.partition, check.preview)
          || canonicalPartitionJson(check.preview.adapterIdentities ?? []) !== canonicalPartitionJson(partitionAdapterIdentities(check.request.model))) return false;
      }
      return authorize(check);
    },
    ...(typeof statelessPrefixCache === 'boolean' ? { statelessPrefixCache } : {}) };
  const completions = createChatCompletions(options), responses = createResponses(options), messages = createMessages(options);
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
      if (path === '/v1/messages') return messages.handle(req, res);
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
          && (model.partition ? availablePartitionRoute(model, approvals) : ['ready', 'busy'].includes(model.availability) && model.providerIds?.length));
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
      await Promise.all([completions.close(), responses.close(), messages.close(), recovery.close()]);
    }
  });
}
