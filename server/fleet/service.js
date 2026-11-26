import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { signAsParticipant, verifyParticipantSignature } from '../../shared/vendor/reploid/artifacts/participant-proofs.js';
import { assert, same, text, FLEET_SERVICE_REQUEST_SCHEMA as DOMAIN, SERVICE_CREDIT_REFUSAL_STATUS } from './contract.js';
import { planFleetPlacement } from './placement.js';
import { createNativeEarningStorage } from '../native-earning.js';
import { openFleetCredits } from './credits.js';
import { canonicalRouteAttemptBinding } from '../../shared/vendor/reploid/mesh/partitions/partition-contract.js';
import { policyDigest } from './settlement-terms.js';
import { issueSettlementStatement } from './settlement-statement.js';
import { coordinatorFor, openCoordinatorKey } from './coordinator-key.js';


/** The coordinator's public key (coordinator-key.js) for anyone who asks: `GET /v1/fleet/coordinator`. It is public by design. */
export function answerCoordinatorKey(response, coordinator) {
  response.writeHead(coordinator ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(coordinator ? coordinator.publicKey : { error: 'This ledger signs no settlement statements: it has no coordinator key' }));
}

/** Private to enrolled signers, using TLS outside loopback. `coordinator` (coordinatorFor) lets it sign settlement statements. */
export async function startFleetService({ credits, models, placementPolicy, port = 0, listenHost = '127.0.0.1', tls = null,
  now = Date.now, maxBodyBytes = 1048576, directory = 'full', coordinator = null }) {
  assert(['127.0.0.1', '::1', 'localhost'].includes(listenHost) || tls?.key && tls?.cert,
    'Non-loopback fleet service requires TLS');
  const fleet = createFleetServiceHandler({ credits, models, placementPolicy, now, maxBodyBytes, directory, coordinator });
  const handle = (request, response) => {
    if (request.method === 'POST' && request.url === '/v1/fleet') return fleet.handle(request, response);
    if (request.method === 'GET' && request.url === '/v1/fleet/coordinator') return answerCoordinatorKey(response, coordinator);
    response.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ error: 'Unknown fleet endpoint' }));
  };
  const server = tls ? https.createServer(tls, handle) : http.createServer(handle);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, listenHost, resolve); });
  return { url: `${tls ? 'https' : 'http'}://${listenHost.includes(':') ? '[' + listenHost + ']' : listenHost}:${server.address().port}/v1/fleet`,
    close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }) };
}

/**
 * The signed fleet operations as one request handler, for its own server or a hosted mount at `POST /v1/fleet`.
 * `directory: 'own'` is for a self-serve ledger: `snapshot` returns only the caller's account and `computers`
 * lists accounts by their public labels, so one person cannot read every other account's balance.
 */
export function createFleetServiceHandler({ credits, models, placementPolicy, now = Date.now, maxBodyBytes = 1048576, directory = 'full', coordinator = null }) {
  assert(['full', 'own'].includes(directory), 'Fleet directory must be full or own');
  assert(coordinator === null || typeof coordinator.signer?.sign === 'function' && coordinator.publicKey?.coordinatorId === coordinator.signer.participantId,
    'Coordinator signer and its published key required');
  const observations = new Map(), demand = new Map(), links = new Map();
  const invoke = async (signer, operation, payload, envelope) => {
    const owner = credits.enrollment.byPeer.get(signer);
    assert(owner, 'Unenrolled computer');
    assert(owner.revokedAt === undefined, 'This computer key was removed from its account');
    switch (operation) {
      case 'reserve': {
        assert(payload.consumer === signer, 'Cannot reserve another computer’s credit');
        const model = models.find(model => model.id === payload.model.id && model.identity === payload.model.identity);
        assert(model, 'Model is not enabled for this service');
        if (payload.mode === 'whole-model') assert(payload.providers.length === 1 && payload.providers[0].weight === 1, 'Invalid whole-model credit share');
        else {
          const plan = model.plans?.find(plan => plan.id === payload.route?.route?.planId);
          assert(plan && same(plan.creditWeights, payload.providers.map(row => row.weight)), 'Stage shares differ from the operator’s terms');
        }
        return credits.reserve(payload);
      }
      case 'dispatch':
        return credits.dispatch(payload.id, signer);
      case 'closeStageOwner': return credits.closeStageOwner(envelope);
      case 'admitOwnedStage':
      case 'admit': {
        const observation = observations.get(owner.computerId);
        if (observation) assert(observation.preferences.enabled === true
          && observation.preferences.models.some(model => model.id === payload.model?.id && model.identity === payload.model?.identity),
        'Provider owner no longer allows this model');
        const row = credits.request(payload.id), request = row?.binding;
        // The commonest mismatch, named: this provider would generate past the limit the requester reserved.
        assert(!(row?.state === 'dispatched' && request.providers.some(provider => provider.participantId === signer)
          && Number.isSafeInteger(payload.outputLimit) && payload.outputLimit > request.maxOutputTokens),
          `Provider output limit ${payload.outputLimit} exceeds the requester's reserved limit of ${request?.maxOutputTokens}: `
          + 'the requester must send its smaller limit as the request\'s maxOutputTokens setting, or raise its own maxOutputTokens');
        assert(row?.state === 'dispatched' && now() <= request.deadline && request.consumer === payload.consumer
          && request.executionId === payload.executionId && request.mode === payload.mode
          && request.providers.some(provider => provider.participantId === signer)
          && same(request.model, payload.model) && Number.isSafeInteger(payload.outputLimit)
          && payload.outputLimit > 0 && payload.outputLimit <= request.maxOutputTokens, 'No matching live credit admission');
        if (request.mode === 'whole-model') {
          assert(request.inputDigest === payload.inputDigest, 'Input differs from credit admission');
          // Both absent, or equal. The provider derives its digest from the request it received.
          assert((request.settingsDigest ?? null) === (payload.settingsDigest ?? null), 'Generation settings differ from credit admission');
        }
        else assert(same(request.route, canonicalRouteAttemptBinding(payload.route))
          && request.providers[payload.partitionIndex]?.participantId === signer, 'Stage differs from credit admission');
        const owned = operation === 'admitOwnedStage';
        if (owned) assert(request.mode === 'partition' && typeof payload.owner === 'string' && /^[a-f0-9]{64}$/.test(payload.owner),
          'Exclusive partition stage owner is required');
        credits.admit(payload.id, request.mode === 'whole-model' ? 0 : payload.partitionIndex, owned ? payload.owner : null);
        return { admitted: true, deadline: request.deadline, maximum: request.maximum };
      }
      case 'preadmit': {
        // The provider's credit check before the prompt is disclosed: everything `admit` checks that does not
        // need the prompt, against the commitment the requester reserved. It changes nothing; `admit` still
        // follows with the input digest once the request has arrived.
        const observation = observations.get(owner.computerId);
        if (observation) assert(observation.preferences.enabled === true
          && observation.preferences.models.some(model => model.id === payload.model?.id && model.identity === payload.model?.identity),
        'Provider owner no longer allows this model');
        const row = credits.request(payload.id), request = row?.binding;
        assert(row?.state === 'dispatched' && now() <= request.deadline && request.mode === 'whole-model' && payload.mode === 'whole-model'
          && request.consumer === payload.consumer && request.executionId === payload.executionId
          && request.providers.length === 1 && request.providers[0].participantId === signer
          && same(request.model, payload.model), 'No matching live credit admission');
        assert(request.admission?.schema === 'reploid.credit-preadmission/v1' && request.admission.commitment === payload.commitment,
          'Reservation does not bind this pre-disclosure commitment');
        return { preadmitted: true, deadline: request.deadline, maximum: request.maximum, maxOutputTokens: request.maxOutputTokens };
      }
      case 'abandonBeforeDispatch':
        return credits.abandonBeforeDispatch(payload.id, signer) ?? { abandoned: true };
      case 'collect':
      case 'fence':
      case 'recover':
      case 'settle': {
        const request = credits.request(payload.id)?.binding;
        assert(request && (request.consumer === signer || request.providers.some(row => row.participantId === signer)), 'Not a participant in this request');
        if (operation === 'collect') return credits.collect(payload.id, payload.evidence);
        if (operation === 'fence') return credits.fence(payload.id, signer);
        if (operation === 'recover') return credits.recover(payload.id);
        return credits.settle(payload.id, payload.evidence);
      }
      case 'recoverMine': return credits.recoverFor(signer);
      case 'providerOpenMine': return credits.providerOpenRequests(signer);
      case 'reconcileMine': return credits.reconcileConsumer(signer, payload?.activeIds ?? []);
      case 'statementMine': return credits.statement(owner.ownerId);
      case 'snapshot': {
        const snapshot = credits.snapshot();
        if (directory === 'full') return snapshot;
        // Conservation is still checked inside snapshot(); only the caller's own account and journal leave it.
        return { unit: snapshot.unit, policyVersion: snapshot.policyVersion, accountUnit: snapshot.accountUnit,
          accounts: snapshot.accounts.filter(row => row.id === owner.ownerId),
          journal: snapshot.journal.filter(row => row.account_id === owner.ownerId) };
      }
      case 'computers': return { at: now(), computers: [...credits.enrollment.byId.values()].map(computer => {
        const observation = observations.get(computer.id);
        const online = !!observation && now() - observation.observedAt <= placementPolicy.maxObservationAgeMs;
        // A self-serve directory lists the caller's own account and accounts serving now, never the whole enrollment.
        if (directory === 'own' && computer.id !== owner.computerId && !online) return null;
        return { id: computer.id, name: computer.name, participantIds: computer.providers
          .filter(provider => directory === 'full' || provider.revokedAt === undefined).map(provider => provider.participantId),
          online, observedAt: observation?.observedAt ?? null,
          ...(online ? { activeRequests: observation.activeRequests, preparing: observation.preparing === true, resident: observation.resident,
            preferences: observation.preferences, freeGpuBytes: observation.freeGpuBytes, freeHostBytes: observation.freeHostBytes,
            maxStorageBufferBindingSize: observation.maxStorageBufferBindingSize } : {}) };
      }).filter(Boolean) };
      case 'terms': {
        const model = models.find(row => row.id === payload.id && row.identity === payload.identity);
        assert(model, 'Model is not enabled for this service');
        return { model: structuredClone(model), policy: credits.policy };
      }
      case 'trace': {
        const request = credits.request(payload.id);
        assert(request && (request.binding.consumer === signer || request.binding.providers.some(row => row.participantId === signer)), 'Not a participant in this request');
        const trace = credits.trace(payload.id);
        return { ...trace, policyDigest: await policyDigest(trace.policy) };
      }
      case 'settlementStatement': {
        // The coordinator's signed statement for a final reservation, to one of its participants presenting the signed
        // records it holds (settlement-statement.js). The ledger signs only what its own journal and hold show.
        const request = credits.request(payload?.id);
        assert(request && (request.binding.consumer === signer || request.binding.providers.some(row => row.participantId === signer)), 'Not a participant in this request');
        if (!coordinator) throw Object.assign(Error('This ledger signs no settlement statements: it was started without a coordinator key'), { statementRefusal: 'no-coordinator-key' });
        return { statement: await issueSettlementStatement({ credits, signer: coordinator.signer, id: payload.id, records: payload.records, now }) };
      }
      case 'request': {
        const request = credits.request(payload.id);
        assert(request && (request.binding.consumer === signer || request.binding.providers.some(row => row.participantId === signer)), 'Not a participant in this request');
        return request;
      }
      case 'observe': {
        assert(payload.id === owner.computerId && payload.participantId === signer, 'Cannot advertise another computer');
        assert(Number.isSafeInteger(payload.observedAt) && Math.abs(payload.observedAt - now()) <= credits.policy.maxClockSkewMs,
          'Capacity observation is outside the clock-skew bound');
        assert(!observations.has(owner.computerId) || payload.observedAt >= observations.get(owner.computerId).reportedAt, 'Older observation cannot replace current capacity');
        // Receipt time owns expiry; preserve the signed sender time without requiring synchronized clocks.
        const observation = { ...structuredClone(payload), reportedAt: payload.observedAt, observedAt: now() };
        planFleetPlacement({ computers: [observation], demand: [], models, links: [], policy: placementPolicy, now: now() });
        observations.set(owner.computerId, observation);
        return { accepted: true };
      }
      case 'demand':
        assert(text(payload.id) && Array.isArray(payload.requests) && payload.requests.length <= credits.policy.maxPendingPerComputer, 'Bounded demand required');
        planFleetPlacement({ computers: [], demand: payload.requests, models, links: [], policy: placementPolicy, now: now() });
        demand.set(owner.computerId, { at: now(), requests: structuredClone(payload.requests) });
        return { accepted: true };
      case 'links':
        assert(Array.isArray(payload) && payload.length <= credits.enrollment.byId.size && payload.every(row => row.from === owner.computerId), 'Own measured links only');
        links.set(owner.computerId, structuredClone(payload));
        return { accepted: true };
      case 'plan': {
        const workloads = new Map();
        for (const item of demand.values()) {
          if (now() - item.at > placementPolicy.maxObservationAgeMs) continue;
          for (const row of item.requests) {
            const id = `${row.id}:${row.identity}`, prior = workloads.get(id);
            workloads.set(id, prior ? { ...row, queued: prior.queued + row.queued, since: Math.min(row.since, prior.since),
              promptTokens: Math.max(row.promptTokens, prior.promptTokens), outputTokens: Math.max(row.outputTokens, prior.outputTokens) } : row);
          }
        }
        return planFleetPlacement({ computers: [...observations.values()], demand: [...workloads.values()],
          models, links: [...links.values()].flat(), policy: placementPolicy, now: now() });
      }
      case 'rank': {
        // Every measured, currently feasible whole-model provider for one workload, cheapest estimate first.
        // Read-only: it registers no demand and changes no placement. An estimate, not a promise of speed.
        const model = models.find(row => row.id === payload?.id && row.identity === payload?.identity);
        assert(model && Number.isSafeInteger(payload.promptTokens) && payload.promptTokens >= 0
          && Number.isSafeInteger(payload.outputTokens) && payload.outputTokens > 0, 'Exact model and bounded workload required');
        const computers = [...observations.values()];
        const plan = planFleetPlacement({ computers, models, links: [], policy: placementPolicy, now: now(),
          demand: [{ id: model.id, identity: model.identity, since: now(), promptTokens: payload.promptTokens, outputTokens: payload.outputTokens,
            queued: Math.max(1, computers.length) * placementPolicy.queuedRequestsPerReplica }] });
        return { schema: 'reploid.fleet-provider-ranking/v1', at: now(), modelId: model.id, modelIdentity: model.identity,
          providers: plan.routes.filter(route => route.mode === 'whole-model').sort((a, b) => a.estimatedMs - b.estimatedMs
            || a.computers[0].localeCompare(b.computers[0])).map(route => ({ computerId: route.computers[0],
            participantIds: credits.enrollment.byId.get(route.computers[0]).providers.map(provider => provider.participantId),
            estimatedMs: route.estimatedMs, serviceEstimate: route.serviceEstimate, busy: route.busy === true })) };
      }
      default: throw Error('Unknown fleet operation');
    }
  };
  const handle = async (request, response) => {
    try {
      assert(request.method === 'POST', 'Unknown fleet endpoint');
      const chunks = []; let length = 0;
      for await (const chunk of request) { length += chunk.length; assert(length <= maxBodyBytes, 'Fleet request too large'); chunks.push(chunk); }
      const envelope = JSON.parse(Buffer.concat(chunks));
      const { signature, ...body } = envelope;
      assert(body.schema === DOMAIN && text(body.nonce) && text(body.operation) && Number.isSafeInteger(body.at)
        && Math.abs(now() - body.at) <= credits.policy.maxClockSkewMs, 'Invalid or stale fleet request');
      const registered = credits.enrollment.byPeer.get(body.participantId);
      assert(registered && await verifyParticipantSignature(registered.publicJwk, DOMAIN, body, signature), 'Invalid fleet request signature');
      // Mutations remain idempotent by reservation/work identity. Observations replace only the sender’s slot.
      const result = await invoke(body.participantId, body.operation, body.payload, { ...body, signature });
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ result }));
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: error.message, ...(error.creditRefusal ? { refusal: error.creditRefusal } : {}),
        ...(typeof error.statementRefusal === 'string' ? { statementRefusal: error.statementRefusal } : {}) }));
    }
  };
  return { handle, invoke };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const configuration = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  assert(configuration.schema === 'reploid.fleet-service/v1', 'Explicit fleet service configuration required');
  const computers = JSON.parse(await fs.readFile(configuration.enrollmentFile, 'utf8'));
  const models = JSON.parse(await fs.readFile(configuration.modelsFile, 'utf8'));
  const credits = await openFleetCredits({ file: configuration.databaseFile, computers, policy: configuration.creditPolicy });
  let service;
  try {
    const tls = configuration.tls ? { key: await fs.readFile(configuration.tls.keyFile), cert: await fs.readFile(configuration.tls.certFile) } : null;
    // Optional. Named, the key file must already exist (coordinator-key.js create): the service never makes one.
    const coordinator = configuration.coordinatorKeyFile === undefined ? null : await coordinatorFor(await openCoordinatorKey(configuration.coordinatorKeyFile));
    service = await startFleetService({ credits, models, placementPolicy: configuration.placementPolicy,
      listenHost: configuration.listenHost, port: configuration.port, tls, coordinator });
    console.log(JSON.stringify({ ready: true, url: service.url, coordinatorId: coordinator?.publicKey.coordinatorId ?? null }));
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  } finally { await service?.close(); credits.close(); }
}

function createPinnedTlsFetch(ca) {
  return (url, options = {}) => new Promise((resolve, reject) => {
    const target = new URL(url);
    const bodyBuffer = options.body ? Buffer.from(options.body) : null;
    const req = https.request(target, {
      method: options.method || 'POST',
      headers: { ...options.headers, ...(bodyBuffer ? { 'content-length': String(bodyBuffer.length) } : {}) },
      ca
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const textBody = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode || 500,
          json: async () => JSON.parse(textBody)
        });
      });
    });
    const onAbort = () => req.destroy(options.signal?.reason || Error('Fleet TLS request aborted'));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) { onAbort(); return; }
    req.on('error', reject);
    req.on('close', () => options.signal?.removeEventListener('abort', onAbort));
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

export function createFleetClient({ url, identity, fetchImpl = null, ca = null, now = Date.now, outboxFile = null }) {
  const target = new URL(url);
  assert(target.protocol === 'https:' || target.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname),
    'Fleet service requires HTTPS or an owned loopback tunnel');
  const send = fetchImpl || (ca && target.protocol === 'https:' ? createPinnedTlsFetch(ca) : fetch);
  const call = async (operation, payload) => {
    payload = wireValue(payload);
    const body = { schema: DOMAIN, participantId: identity.peerId, operation, payload, at: now(), nonce: randomUUID() };
    const signature = await signAsParticipant(identity, DOMAIN, body);
    const response = await send(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, signature }), signal: AbortSignal.timeout(30000) });
    const answer = await response.json();
    if (!response.ok || answer.error) {
      // A credit refusal keeps its stable code and quote, and the HTTP status the text API answers with.
      const refusal = Object.hasOwn(SERVICE_CREDIT_REFUSAL_STATUS, answer.refusal?.code ?? '') ? answer.refusal : null;
      throw Object.assign(Error(answer.error || 'Fleet request failed'),
        { code: response.status === 400 ? 'FLEET_REJECTED' : 'FLEET_UNAVAILABLE',
          ...(refusal ? { creditRefusal: refusal, status: SERVICE_CREDIT_REFUSAL_STATUS[refusal.code] } : {}),
          ...(typeof answer.statementRefusal === 'string' ? { statementRefusal: answer.statementRefusal } : {}) });
    }
    return answer.result;
  };
  const storage = outboxFile ? createNativeEarningStorage(outboxFile) : null;
  let writes = Promise.resolve();
  const update = operation => {
    const result = writes.then(async () => {
      const rows = await storage.get('settlements') || [];
      await storage.set('settlements', operation(rows));
    });
    writes = result.catch(() => {}); return result;
  };
  async function settle(id, evidence) {
    evidence = wireValue(evidence);
    if (storage) await update(rows => {
      const prior = rows.find(row => row.id === id);
      assert(!prior || same(prior.evidence, evidence), 'Conflicting pending settlement');
      return prior ? rows : [...rows, { id, evidence: structuredClone(evidence) }];
    });
    let result;
    try { result = await call('settle', { id, evidence }); }
    catch (error) {
      if (storage && error.code === 'FLEET_REJECTED') {
        await quarantine({ operation: 'settle', payload: { id, evidence }, error: error.message });
        await update(rows => rows.filter(row => row.id !== id));
      }
      throw error;
    }
    if (storage) await update(rows => rows.filter(row => row.id !== id));
    return result;
  }
  const quarantine = async record => {
    // Invalid proof is retained for diagnosis, never retried as if a transient network failure.
    const key = `rejected:${record.operation}:${record.payload.id}`;
    await storage.set(key, record);
  };
  let recoveryWrites = Promise.resolve();
  const changeRecovery = task => {
    const run = recoveryWrites.then(async () => {
      if (!storage) return;
      await storage.set('recovery', task(await storage.get('recovery') || []));
    });
    recoveryWrites = run.catch(() => {}); return run;
  };
  async function recoverable(operation, payload) {
    payload = wireValue(payload);
    const key = JSON.stringify({ operation, payload });
    await changeRecovery(rows => rows.some(row => row.key === key) ? rows : [...rows, { key, operation, payload }]);
    let result;
    try { result = await call(operation, payload); }
    catch (error) {
      if (storage && error.code === 'FLEET_REJECTED') {
        await quarantine({ operation, payload, error: error.message });
        await changeRecovery(rows => rows.filter(row => row.key !== key));
      }
      throw error;
    }
    // Collected pieces are durable at the service. A fence remains retryable until final settlement.
    if (operation === 'collect' || result.status !== 'pending') await changeRecovery(rows => rows.filter(row => row.key !== key));
    return result;
  }
  return { call, collect: (id, evidence) => recoverable('collect', { id, evidence }),
    fence: id => recoverable('fence', { id }), reserve: payload => call('reserve', payload), dispatch: id => call('dispatch', { id }), settle,
    abandonBeforeDispatch: id => call('abandonBeforeDispatch', { id }),
    statement: () => call('statementMine', {}),
    async reconcile({ activeIds = null } = {}) {
      await Promise.all([writes, recoveryWrites]);
      const pending = storage ? await storage.get('settlements') || [] : [], outcomes = [];
      for (const row of pending) {
        try { outcomes.push(await settle(row.id, row.evidence)); }
        catch (error) { outcomes.push({ id: row.id, status: 'pending', error: error.message }); }
      }
      const recovery = storage ? await storage.get('recovery') || [] : [];
      for (const row of recovery) {
        try { outcomes.push(await recoverable(row.operation, row.payload)); }
        catch (error) { outcomes.push({ id: row.payload.id, status: 'pending', error: error.message }); }
      }
      if (Array.isArray(activeIds)) {
        const consumerOutcomes = await call('reconcileMine', { activeIds });
        for (const row of consumerOutcomes) {
          if (!outcomes.some(value => value.id === row.id)) outcomes.push(row);
        }
      }
      const recovered = await call('recoverMine', {});
      return [...outcomes, ...recovered.filter(row => !outcomes.some(value => value.id === row.id))];
    } };
}

/** Sign and retain the exact JSON bytes' value. Sparse arrays and non-finite numbers are
 * not valid evidence; object properties explicitly left undefined are omitted before signing. */
function wireValue(value) {
  const visit = (item, array = false) => {
    assert(item !== undefined || !array, 'Undefined array entry in fleet evidence');
    assert(typeof item !== 'number' || Number.isFinite(item), 'Non-finite fleet value');
    if (Array.isArray(item)) for (let i = 0; i < item.length; i++) visit(item[i], true);
    else if (item && typeof item === 'object') for (const field of Object.values(item)) visit(field);
  };
  visit(value);
  return JSON.parse(JSON.stringify(value));
}
