import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { signAsParticipant, verifyParticipantSignature } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { assert, same, text } from './contract.js';
import { planFleetPlacement } from './placement.js';
import { createNativeEarningStorage } from '../native-earning.js';
import { openFleetCredits } from './credits.js';
import { canonicalRouteAttemptBinding } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';

const DOMAIN = 'reploid.fleet-service-request/v1';

/** Private to enrolled signers, using TLS outside loopback. */
export async function startFleetService({ credits, models, placementPolicy, port = 0, listenHost = '127.0.0.1', tls = null,
  now = Date.now, maxBodyBytes = 1048576 }) {
  assert(['127.0.0.1', '::1', 'localhost'].includes(listenHost) || tls?.key && tls?.cert,
    'Non-loopback fleet service requires TLS');
  const observations = new Map(), demand = new Map(), links = new Map();
  const invoke = async (signer, operation, payload) => {
    const owner = credits.enrollment.byPeer.get(signer);
    assert(owner, 'Unenrolled computer');
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
      case 'admit': {
        const observation = observations.get(owner.computerId);
        if (observation) assert(observation.preferences.enabled === true
          && observation.preferences.models.some(model => model.id === payload.model?.id && model.identity === payload.model?.identity),
        'Provider owner no longer allows this model');
        const row = credits.request(payload.id), request = row?.binding;
        assert(row?.state === 'dispatched' && now() <= request.deadline && request.consumer === payload.consumer
          && request.executionId === payload.executionId && request.mode === payload.mode
          && request.providers.some(provider => provider.participantId === signer)
          && same(request.model, payload.model) && Number.isSafeInteger(payload.outputLimit)
          && payload.outputLimit > 0 && payload.outputLimit <= request.maxOutputTokens, 'No matching live credit admission');
        if (request.mode === 'whole-model') assert(request.inputDigest === payload.inputDigest, 'Input differs from credit admission');
        else assert(same(request.route, canonicalRouteAttemptBinding(payload.route))
          && request.providers[payload.partitionIndex]?.participantId === signer, 'Stage differs from credit admission');
        return { admitted: true, deadline: request.deadline, maximum: request.maximum };
      }
      case 'abandonBeforeDispatch':
        return credits.abandonBeforeDispatch(payload.id, signer) ?? { abandoned: true };
      case 'settle': {
        const request = credits.request(payload.id)?.binding;
        assert(request && (request.consumer === signer || request.providers.some(row => row.participantId === signer)), 'Not a participant in this request');
        return credits.settle(payload.id, payload.evidence);
      }
      case 'snapshot': return credits.snapshot();
      case 'terms': {
        const model = models.find(row => row.id === payload.id && row.identity === payload.identity);
        assert(model, 'Model is not enabled for this service');
        return { model: structuredClone(model), policy: credits.policy };
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
      default: throw Error('Unknown fleet operation');
    }
  };
  const handle = async (request, response) => {
    try {
      assert(request.method === 'POST' && request.url === '/v1/fleet', 'Unknown fleet endpoint');
      const chunks = []; let length = 0;
      for await (const chunk of request) { length += chunk.length; assert(length <= maxBodyBytes, 'Fleet request too large'); chunks.push(chunk); }
      const envelope = JSON.parse(Buffer.concat(chunks));
      const { signature, ...body } = envelope;
      assert(body.schema === DOMAIN && text(body.nonce) && text(body.operation) && Number.isSafeInteger(body.at)
        && Math.abs(now() - body.at) <= credits.policy.maxClockSkewMs, 'Invalid or stale fleet request');
      const registered = credits.enrollment.byPeer.get(body.participantId);
      assert(registered && await verifyParticipantSignature(registered.publicJwk, DOMAIN, body, signature), 'Invalid fleet request signature');
      // Mutations remain idempotent by reservation/work identity. Observations replace only the sender’s slot.
      const result = await invoke(body.participantId, body.operation, body.payload);
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ result }));
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: error.message }));
    }
  };
  const server = tls ? https.createServer(tls, handle) : http.createServer(handle);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, listenHost, resolve); });
  return { url: `${tls ? 'https' : 'http'}://${listenHost.includes(':') ? '[' + listenHost + ']' : listenHost}:${server.address().port}/v1/fleet`,
    close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }) };
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
    service = await startFleetService({ credits, models, placementPolicy: configuration.placementPolicy,
      listenHost: configuration.listenHost, port: configuration.port, tls });
    console.log(JSON.stringify({ ready: true, url: service.url }));
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  } finally { await service?.close(); credits.close(); }
}

export function createFleetClient({ url, identity, fetchImpl = fetch, now = Date.now, outboxFile = null }) {
  const target = new URL(url);
  assert(target.protocol === 'https:' || target.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname),
    'Fleet service requires HTTPS or an owned loopback tunnel');
  const call = async (operation, payload) => {
    const body = { schema: DOMAIN, participantId: identity.peerId, operation, payload, at: now(), nonce: randomUUID() };
    const signature = await signAsParticipant(identity, DOMAIN, body);
    const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, signature }), signal: AbortSignal.timeout(30000) });
    const answer = await response.json(); assert(response.ok && !answer.error, answer.error || 'Fleet request failed'); return answer.result;
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
    if (storage) await update(rows => {
      const prior = rows.find(row => row.id === id);
      assert(!prior || same(prior.evidence, evidence), 'Conflicting pending settlement');
      return prior ? rows : [...rows, { id, evidence: structuredClone(evidence) }];
    });
    const result = await call('settle', { id, evidence });
    if (storage) await update(rows => rows.filter(row => row.id !== id));
    return result;
  }
  return { call, reserve: payload => call('reserve', payload), dispatch: id => call('dispatch', { id }), settle,
    abandonBeforeDispatch: id => call('abandonBeforeDispatch', { id }),
    async reconcile() {
      if (!storage) return [];
      await writes;
      const pending = await storage.get('settlements') || [], outcomes = [];
      for (const row of pending) {
        try { outcomes.push(await settle(row.id, row.evidence)); }
        catch (error) { outcomes.push({ id: row.id, status: 'pending', error: error.message }); }
      }
      return outcomes;
    } };
}
