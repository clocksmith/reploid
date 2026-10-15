/**
 * Native contributor earning: the composition a native participant passes as
 * its `earning` port (native-participant.js). From an explicit
 * reploid.native-earning/v1 file it signs this host in through the service's
 * sign-in flow, registers the host's persistent participant identity as a
 * native device, records the owner policy in force, asks the service for a
 * stage-share offer for the model and partition plan this host serves, accepts
 * it, and claims each settled stage share under the offer that covered it.
 * Durable state (session, outbox, claims and accepted offers) lives in one
 * file beside the identity, so a restarted host neither loses nor doubles a
 * claim. Off unless the file is given; the repository ships none.
 *
 * File: { schema: 'reploid.native-earning/v1',
 *         client: { schema: 'reploid.earning-client/v1', enabled: true, baseUrl, providerId },
 *         signIn?: { subject } }   // only for the service's local test flow
 *
 * Native sign-in supports the local test flow only: Supabase email links
 * complete in a browser, and a native link flow is not implemented.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { hashDopplerEvidence } from '../self/pool/executable-pack.js';
import { EARNING_CLIENT_SCHEMA, createEarningClient, readEarningClientConfig } from '../self/host/earning/client.js';
import { createEarningContribution } from '../self/host/earning/contribution.js';

export const NATIVE_EARNING_SCHEMA = 'reploid.native-earning/v1';
const STAGE_SHARE = 'demanded_inference';
// An offer is renewed once this share of its duration has passed, so the next one is accepted before it ends.
const RENEW_AT = 0.9;
const SUBJECT = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const fail = (message) => { throw new Error(message); };
const toMs = (value) => (typeof value === 'number' ? value : Date.parse(value));
const modelKey = ({ modelId, modelIdentity, planId }) => `${modelId}|${modelIdentity}|${planId}`;

/** Read and check the native earning file: an absolute path to a regular JSON file. */
export async function readNativeEarningFile(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) fail('--earning-config requires an absolute path');
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) fail(`--earning-config must name a regular file: ${file}`);
  let value;
  try { value = JSON.parse(await fs.readFile(file, 'utf8')); } catch { fail(`--earning-config is not valid JSON: ${file}`); }
  const keys = Object.keys(value ?? {});
  if (value?.schema !== NATIVE_EARNING_SCHEMA || keys.some((key) => !['schema', 'client', 'signIn'].includes(key))) {
    fail(`--earning-config must be ${NATIVE_EARNING_SCHEMA} with client and an optional signIn`);
  }
  if (value.client?.schema !== EARNING_CLIENT_SCHEMA || value.client.enabled !== true) fail(`--earning-config client must be an enabled ${EARNING_CLIENT_SCHEMA} configuration`);
  const client = readEarningClientConfig(value.client);
  if (value.signIn !== undefined && (Object.keys(value.signIn ?? {}).join() !== 'subject' || !SUBJECT.test(value.signIn.subject ?? ''))) {
    fail('--earning-config signIn must be { subject } with a short lowercase name');
  }
  return Object.freeze({ client, signIn: value.signIn ? { subject: value.signIn.subject } : null });
}

/** Durable { get, set, delete } over one JSON file, written whole and renamed into place. */
export function createNativeEarningStorage(file) {
  let queue = Promise.resolve();
  const load = async () => {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  };
  const write = (change) => {
    const run = queue.then(async () => {
      const state = await load();
      change(state);
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await fs.rename(temporary, file);
    });
    queue = run.catch(() => {});
    return run;
  };
  return Object.freeze({
    async get(key) { await queue; const state = await load(); return key in state ? structuredClone(state[key]) : null; },
    set: (key, value) => write((state) => { state[key] = structuredClone(value); }),
    delete: (key) => write((state) => { delete state[key]; })
  });
}

/** The sign-in port for a native host: the service's local test flow for the configured subject. */
export function createNativeSignIn({ config, subject, fetch = globalThis.fetch }) {
  return async ({ providerId = config.providerId } = {}) => {
    const settings = await fetch(`${config.baseUrl}/sign-in/${encodeURIComponent(providerId)}`).then((response) => (response.ok ? response.json() : null)).catch(() => null);
    if (settings?.flow !== 'local_test_subject') {
      fail(`Native sign-in supports the service's local test flow only; ${providerId} offers ${settings?.flow ?? 'no flow this host can use'}`);
    }
    if (!subject) fail('The local test flow needs signIn.subject in the native earning file');
    const response = await fetch(`${config.baseUrl}/sign-in/${encodeURIComponent(providerId)}/assertions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject })
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || typeof body?.assertion !== 'string') fail(body?.message || `The sign-in service answered ${response.status}`);
    return body.assertion;
  };
}

/**
 * @param {object} options
 * @param {object} options.settings readNativeEarningFile(...) result
 * @param {object} options.identity this host's persistent participant identity
 * @param {object} options.ownerAuthorization { policy, digest } of the owner policy in force
 * @param {object} options.storage createNativeEarningStorage(...) or an equivalent durable store
 */
export async function openNativeEarning({ settings, identity, ownerAuthorization, storage, fetch = globalThis.fetch,
  hashEvidence = hashDopplerEvidence, now = Date.now, signIn = null }) {
  if (!ownerAuthorization?.digest || !ownerAuthorization.policy) fail('Native earning requires the owner policy in force');
  const client = createEarningClient({ config: settings.client, identity, host: 'native', storage, fetch,
    signIn: signIn ?? createNativeSignIn({ config: settings.client, subject: settings.signIn?.subject, fetch }) });
  const session = await client.ensureSession();
  const ownerPolicyDigest = ownerAuthorization.digest;
  const base = createEarningContribution({ client, offers: {}, ownerPolicyDigest, hashEvidence });
  await base.recordOwnerAuthorization(ownerAuthorization);
  const contributions = new Map();
  const contributionFor = (offerId) => {
    if (!contributions.has(offerId)) contributions.set(offerId, createEarningContribution({ client, offers: { stageShare: offerId }, ownerPolicyDigest, hashEvidence }));
    return contributions.get(offerId);
  };
  const readOffers = async () => (await storage.get('offers')) ?? [];
  let offering = Promise.resolve();

  /** An accepted, current stage-share offer for `model`, requested and accepted when none covers now. */
  function ensureOffer(model) {
    const run = offering.then(async () => {
      const offers = await readOffers();
      const current = offers.find((offer) => offer.key === modelKey(model)
        && now() < toMs(offer.startsAt) + RENEW_AT * (toMs(offer.endsAt) - toMs(offer.startsAt)));
      if (current) return current;
      const offered = await client.send({ opId: `offer:${modelKey(model)}:${now()}`, path: '/offers', durable: false,
        body: { category: STAGE_SHARE, model: { modelId: model.modelId, modelIdentity: model.modelIdentity, planId: model.planId } } });
      const accepted = await base.acceptOffer(offered.offerId, ownerAuthorization);
      const record = { offerId: offered.offerId, key: modelKey(model), acceptedAt: accepted.acceptedAt ?? new Date(now()).toISOString(),
        startsAt: offered.duration.startsAt, endsAt: offered.duration.endsAt };
      await storage.set('offers', [...offers, record]);
      return record;
    });
    offering = run.catch(() => {});
    return run;
  }

  return Object.freeze({
    client,
    session,
    participantId: identity.peerId,
    ensureOffer,
    offers: readOffers,
    /**
     * The participant's earning port. `descriptor`, when the host passes its prepared stage, names the
     * model and plan to be offered for before any route admits it; admission records also name their
     * route's model, so a host that passes none still earns from later work.
     */
    async observe({ admissions = [], deliveries = [], descriptor = null } = {}) {
      const served = descriptor?.planId ? [descriptor] : [];
      for (const record of admissions) if (record?.identity?.route?.planId) served.push(record.identity.route);
      const seen = new Set();
      for (const model of served) {
        if (seen.has(modelKey(model))) continue;
        seen.add(modelKey(model));
        await ensureOffer(model);
      }
      const offers = await readOffers();
      // Each record is claimed under the accepted offer whose window covered its admission.
      const groups = new Map();
      for (const record of admissions) {
        const at = toMs(record?.reservedAt);
        const offer = offers.find((row) => row.key === modelKey(record?.identity?.route ?? {}) && toMs(row.acceptedAt) <= at && at <= toMs(row.endsAt));
        if (!offer) continue;
        groups.set(offer.offerId, [...(groups.get(offer.offerId) ?? []), record]);
      }
      // Signed receipts of every closed charged attempt are submitted, offer or not: they settle the requester's charge.
      const { evidence, deliveries: delivered } = await base.observe({ admissions, deliveries });
      const results = { evidence, stages: [], deliveries: delivered };
      for (const [offerId, records] of groups) results.stages.push(...await contributionFor(offerId).claimStageShares(records));
      return results;
    },
    reconcile: () => client.reconcile()
  });
}

export default openNativeEarning;
