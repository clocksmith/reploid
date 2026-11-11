import { createHttpRequestOwner } from './http-request-owner.js';
import { canonicalPartitionJson, partitionAdapterIdentities } from '../packages/reploid/src/mesh/partitions/partition-contract.js';
import { requireGenerationCapability, tokenUsage } from '../packages/reploid/src/mesh/partitions/partition-generation-request.js';
/** Text-only HTTP projection of admitted whole-model and partition routes. No model fallback. */
import { randomUUID } from 'node:crypto';
import policy from '../apps/poolday/config/partition-policy.json' with { type: 'json' };

export const fail = (status, message, param = null) => Object.assign(new Error(message), { status, param });
export const assert = (ok, message) => { if (!ok) throw fail(502, message); };
export const object = value => value && typeof value === 'object' && !Array.isArray(value);
export const freeze = value => { if (object(value) || Array.isArray(value)) { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
const errorBody = error => ({ error: { message: error.message, type: error.status < 500 ? 'invalid_request_error' : 'server_error',
  param: error.param || null, code: error.status === 401 ? 'unauthorized' : error.status === 403 ? 'permission_denied'
    : error.code === 'CONTEXT_LENGTH_EXCEEDED' ? 'context_length_exceeded' : null } });
// Protocol adapters borrowing the same requester share its HTTP admission budget.
// Each adapter still owns only its own request cancellation/settlement.
const requesterAdmission = new WeakMap();

export async function readBody(req, signal, parse) {
  const chunks = []; let bytes = 0;
  const aborted = () => req.destroy();
  signal.addEventListener('abort', aborted, { once: true });
  try {
    for await (const chunk of req) {
      signal.throwIfAborted(); bytes += chunk.length;
      if (bytes > policy.controlChannel.maxControlBytes) throw fail(413, 'Request body limit exceeded');
      chunks.push(chunk);
    }
    try { return parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
    catch (error) { if (error.status) throw error; throw fail(400, 'Invalid JSON'); }
  } finally { signal.removeEventListener('abort', aborted); }
}

/** Explicit opt-in: the host authenticates callers AND approves each exact disclosure.
 * The participant and its model/cleanup owners are borrowed, never replaced or closed here.
 */
export function createTextRequester({ participant, authenticate, authorize }, protocol) {
  if (!participant || typeof participant.generate !== 'function' || typeof participant.getState !== 'function'
    || typeof authenticate !== 'function' || typeof authorize !== 'function') throw Error('Text requester requires an actual requester and explicit authentication/authorization ports');
  const formatError = protocol.errorBody || errorBody;
  const requests = createHttpRequestOwner({ timeoutMs: policy.controlChannel.timeoutMs });
  if (!requesterAdmission.has(participant)) requesterAdmission.set(participant, new Set());
  const admitted = requesterAdmission.get(participant);
  const handle = async (req, res) => {
    let pathname;
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; }
    catch { json(res, 400, formatError(fail(400, 'Invalid API route'))); return; }
    if (pathname !== protocol.path) {
      json(res, 404, formatError(fail(404, 'Unsupported API route'))); return;
    }
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return; }
    if (requests.closed || admitted.size >= policy.inputLimits.maxConcurrentAttempts) {
      json(res, requests.closed ? 503 : 429, formatError(fail(requests.closed ? 503 : 429, 'Requester admission unavailable'))); return;
    }
    const scope = requests.begin(req, res, {
      disconnectError: () => Error('HTTP requester disconnected'),
      deadlineError: () => fail(408, 'Request admission deadline exceeded'),
      onFinish: item => admitted.delete(item)
    });
    const { controller, signal } = scope;
    admitted.add(scope.item);
    let streaming = false, emitted = '', sequence = 0, observedUsage = null, disclosureApproved = false, acceptingCallbacks = true;
    let approvedRecipients = [];
    const id = protocol.idPrefix + randomUUID().replaceAll('-', ''), created = Math.floor(Date.now() / 1000);
    let threadId = randomUUID().replaceAll('-', '');
    const attemptId = randomUUID().replaceAll('-', '');
    let model, output;
    const write = data => {
      signal.throwIfAborted();
      if (!streaming) {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' }); streaming = true;
      }
      if (!res.write(data) && res.writableLength > policy.controlChannel.maxBufferedBytes) {
        controller.abort(Error('HTTP stream output buffer exceeded')); signal.throwIfAborted();
      }
    };
    try {
      protocol.validateRequest?.(req);
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'application/json required');
      const authenticated = await authenticate(req, { signal }); signal.throwIfAborted();
      if (!object(authenticated) || typeof authenticated.subject !== 'string' || !authenticated.subject || authenticated.subject.length > 512) throw fail(401, 'Authentication required');
      const principal = freeze({ subject: authenticated.subject });
      const input = await readBody(req, signal, protocol.parse); signal.throwIfAborted();
      if (input.reploid?.conversation_id) threadId = input.reploid.conversation_id;
      const requirePrivateScope = () => {
        if (input.reploid && (participant.roomId !== input.reploid.pool_id
          || !['private-pool', 'local-only'].includes(participant.executionClass))) throw fail(403, 'Requester is not in the permitted private pool');
      };
      requirePrivateScope();
      const models = participant.getState().models || [];
      let eligible = models.filter(value => (value.selectionId === input.model || value.id === input.model && !partitionAdapterIdentities(value).length) && !value.canonical
        && (value.partition || ['ready', 'busy'].includes(value.availability) && value.providerIds?.length));
      if (!eligible.length) throw fail(503, 'No ready route for this exact model variant', 'model');
      if (input.reploid) {
        eligible = eligible.filter(value => value.identity === input.reploid.expected_model_identity
          && (input.reploid.expected_adapter_identities === undefined || canonicalPartitionJson(partitionAdapterIdentities(value)) === canonicalPartitionJson(input.reploid.expected_adapter_identities))
          && (!input.reploid.expected_plan_identity || value.partition?.planId === input.reploid.expected_plan_identity));
        if (!eligible.length) throw fail(409, 'Requested model identity changed');
      }
      if (new Set(eligible.map(value => canonicalPartitionJson([value.identity, partitionAdapterIdentities(value)]))).size !== 1) throw fail(409, 'Model id has ambiguous execution identity', 'model');
      eligible.sort((a, b) => Number(!!a.partition) - Number(!!b.partition));
      model = freeze(structuredClone(eligible[0]));
      assert(typeof model.identity === 'string' && model.identity.length > 0, 'Requester model identity missing');
      if (input.reploid && input.reploid.expected_model_identity !== model.identity) throw fail(409, 'Requested model identity changed');
      const requested = requireGenerationCapability(model, input.generationRequest);
      const request = freeze({ threadId, attemptId, model, messages: input.messages, ...(requested ? {generationRequest:requested} : {}) });
      if (await authorize({ action: 'chat.execute', principal, request, signal }) !== true) throw fail(403, 'Request execution denied');
      requirePrivateScope();
      signal.throwIfAborted(); scope.clearDeadline();
      res.setHeader('x-request-id', id); res.setHeader('x-reploid-attempt-id', attemptId);
      res.setHeader('x-reploid-model-identity', model.identity);
      if (requested) res.setHeader('x-reploid-token-usage', requested.usage);
      output = protocol.output({ id, created, model: model.id, input, write, end: value => res.end(value), json: value => json(res, 200, value) });
      const result = await participant.generate(request, {
        signal, principal, onState() {},
        onReservation(reservationId) {
          if (!res.headersSent && typeof reservationId === 'string' && reservationId.length > 0 && reservationId.length <= 512) {
            res.setHeader('x-reploid-reservation-id', reservationId);
          }
        },
        onUsage(event) {
          try {
            signal.throwIfAborted();
            assert(acceptingCallbacks, 'Requester callback after completion');
            assert(disclosureApproved, 'Recipient disclosure must precede output');
            assert(requested && !observedUsage && sequence === 0 && event?.threadId === threadId && event.attemptId === attemptId
              && event.schema === requested.usage && event.outputTokens === 0, 'Unbound or out-of-order provider token usage');
            observedUsage = tokenUsage(event.inputTokens, event.outputTokens, requested);
            if (input.stream) output.usage?.(observedUsage);
          } catch (error) { controller.abort(error); throw error; }
        },
        async requestApproval(preview) {
          assert(acceptingCallbacks, 'Requester callback after completion');
          disclosureApproved = false;
          try {
            signal.throwIfAborted();
            preview = freeze(structuredClone(preview));
            const recipients = [...new Set([...(preview.recipients || []), ...(preview.input?.recipients || []),
              ...(preview.route?.stages?.map(stage => stage.participantId) || []),
              ...[preview.participantA, preview.participantB, preview.recipientIdentity || preview.providerId].filter(Boolean)])];
            if (input.reploid && (!recipients.length || recipients.some(id => !input.reploid.allowed_recipients.includes(id)))) {
              throw fail(403, 'Actual route recipients exceed the permitted private pool');
            }
            if (input.reploid && ((input.reploid.expected_plan_identity && preview.planId !== input.reploid.expected_plan_identity)
              || canonicalPartitionJson(preview.adapterIdentities || []) !== canonicalPartitionJson(partitionAdapterIdentities(model)))) throw fail(409, 'Disclosure execution identity changed');
            assert(preview?.threadId === threadId && preview.attemptId === attemptId
              && preview.modelId === model.id && preview.modelIdentity === model.identity
              && canonicalPartitionJson(preview.input?.messages ?? null) === canonicalPartitionJson(request.messages)
              && canonicalPartitionJson(preview.input?.generationRequest ?? null) === canonicalPartitionJson(requested ?? null),
            'Disclosure preview differs from the admitted request');
            const approved = await authorize({ action: 'chat.disclose', principal, request,
              preview, signal });
            signal.throwIfAborted();
            if (approved !== true) throw fail(403, 'Recipient disclosure denied');
            requirePrivateScope();
            assert(acceptingCallbacks, 'Requester callback after completion');
            disclosureApproved = true;
            approvedRecipients = recipients;
            return true;
          } catch (error) { controller.abort(error); throw error; }
        },
        onDelta(event) {
          try {
            signal.throwIfAborted();
            assert(acceptingCallbacks, 'Requester callback after completion');
            assert(disclosureApproved, 'Recipient disclosure must precede output');
            assert(event?.threadId === threadId && event.attemptId === attemptId && event.sequence === sequence++
              && typeof event.text === 'string', 'Requester delta identity or sequence mismatch');
            assert(!model.partition || !requested || observedUsage, 'Provider token usage must precede text');
            emitted += event.text;
            assert(emitted.length <= policy.inputLimits.maxOutputCharacters, 'Output text limit exceeded');
            if (input.stream) output.delta(event.text);
          } catch (error) { controller.abort(error); throw error; }
        }
      });
      acceptingCallbacks = false;
      signal.throwIfAborted();
      assert(disclosureApproved, 'Recipient disclosure must precede completion');
      requirePrivateScope();
      assert(result?.threadId === threadId && result.attemptId === attemptId && result.modelId === model.id
        && result.modelIdentity === model.identity, 'Requester result identity mismatch');
      if (!model.partition) assert(canonicalPartitionJson(result.adapterIdentities || []) === canonicalPartitionJson(partitionAdapterIdentities(model)), 'Requester adapter identity mismatch');
      assert(typeof result.content === 'string' && result.content.length <= policy.inputLimits.maxOutputCharacters, 'Invalid requester text result');
      assert(!sequence || emitted === result.content, 'Requester final text differs from streamed text');
      const reason = result.execution?.stopReason;
      assert(['length', 'max-tokens', 'stop', 'eos', 'eos-token', 'stop-token', 'stop-sequence', 'context-limit'].includes(reason), 'Requester termination reason unavailable');
      const finishReason = ['length', 'max-tokens', 'context-limit'].includes(reason) ? 'length' : 'stop';
      let usage;
      if (!model.partition && result.usage !== undefined) {
        assert(result.usage.schema === 'raw-model-tokens/v1'
          && Number.isSafeInteger(result.usage.inputTokens) && result.usage.inputTokens >= 0
          && Number.isSafeInteger(result.usage.outputTokens) && result.usage.outputTokens >= 0
          && Number.isSafeInteger(result.usage.inputTokens + result.usage.outputTokens), 'Invalid whole-model token usage');
        usage = Object.freeze({ schema: result.usage.schema, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens });
      }
      if (requested) {
        usage = tokenUsage(result.usage?.inputTokens, result.usage?.outputTokens, requested);
        assert(model.partition
          ? observedUsage && usage.inputTokens === observedUsage.inputTokens && result.usage.schema === usage.schema
            && usage.outputTokens === (result.execution?.stepSummary?.count ?? result.execution?.steps?.length)
          : !observedUsage && result.usage?.schema === usage.schema
            && usage.inputTokens === result.execution?.completion?.promptTokenCount
            && usage.outputTokens === result.execution?.completion?.generatedTokenCount,
        'Provider final token usage differs from input observation');
      }
      if (input.stream && !sequence) {
        assert(!model.partition || !requested || observedUsage, 'Provider token usage must precede text');
        output.delta(result.content);
      }
      const evidence = input.reploid?.include_execution ? { schema: 'reploid.http-execution/v1',
        threadId, attemptId, poolId: participant.roomId, executionClass: participant.executionClass,
        modelIdentity: model.identity, adapterIdentities: partitionAdapterIdentities(model), planIdentity: model.partition?.planId || null, recipients: approvedRecipients,
        execution: structuredClone(result.execution) } : undefined;
      output.complete(result.content, finishReason, reason, usage, evidence);
    } catch (cause) {
      const error = cause instanceof Error ? cause : fail(502, 'Requester failed');
      controller.abort(error);
      if (!res.destroyed && !res.writableEnded) {
        const body = formatError(error);
        if (streaming) output.error(body.error);
        else json(res, error.status || 502, body);
      }
    } finally {
      acceptingCallbacks = false;
      scope.finish();
    }
  };
  return Object.freeze({ handle, getState: () => ({ closed: requests.closed, active: requests.size, scope: 'http-requests' }),
    close: () => requests.close(() => Error('Text requester server closing'), () => Error('HTTP requester cleanup remains unsettled')) });
}
