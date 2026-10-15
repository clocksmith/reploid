/**
 * @fileoverview Authenticated HTTP routes for the earning loop: accounts,
 * devices, quotes, reservations, balances, reward offers and claims, acquirer
 * delivery evidence, and operator funding, settlement, issuance and link
 * records.
 *
 * Every route names its authentication: none (sign-in and recovery, which
 * present a provider assertion), a session token, a session bound to an
 * active registered device, or an operator credential with a named role from
 * the injected operator-authority port. Account and device always come from
 * the session; operator actors always come from the credential; neither is
 * read from a body. Bodies are parsed only after authentication, under this
 * router's own size limits, and name only the fields each route accepts.
 * An Idempotency-Key binds to its route, authenticated caller and canonical
 * request (idempotency.js). Only a definite no-effect failure frees it; an
 * ambiguous one keeps it, and the retry reconciles through the component's
 * own idempotency under the same derived key. Requests are counted per
 * client address, per account, per device and per operator. There is no
 * local-development bypass.
 */

import express from 'express';

import { sha256Hex } from '../ledger/domain.js';

import {
  authenticateOperator,
  bearerToken,
  bodyOf,
  consumeRate,
  createMemoryRateLimiter,
  RouteError,
  earningErrorHandler,
  idempotencyKeyOf,
  isComponentRefusal,
  refuse,
  validateRouteLimits
} from './http.js';
import { createRouteIdempotency } from './idempotency.js';

const DELIVERY_EVIDENCE_KEYS = Object.freeze(['artifactId', 'authorization', 'index', 'receipt', 'attestation', 'supplierCertificate', 'acquirerCertificate']);
const CLAIM_KEYS = Object.freeze([...DELIVERY_EVIDENCE_KEYS, 'deliveryId', 'reservationId', 'attemptId', 'stageIndex']);
const SETTLEMENT_KEYS = Object.freeze(['billableEventId', 'outcome', 'attemptId', 'metering', 'completedAt', 'reason', 'evidenceRef']);
const COMMITMENT_KEYS = Object.freeze(['commitmentId', 'funderKind', 'funderId', 'externalRef', 'amount', 'unit', 'validFrom', 'validUntil']);

const hasBody = (req) => req.headers['transfer-encoding'] !== undefined
  || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0');

const validationView = (validation) => ({
  validationId: validation.validationId,
  outcome: validation.outcome,
  reasons: validation.reasons.map(({ code, message }) => ({ code, message })),
  category: validation.category,
  workId: validation.workId,
  reward: validation.reward,
  issuanceStatus: validation.issuanceStatus,
  validatedAt: validation.validatedAt
});

const notFound = (code, what) => refuse(404, code, `no ${what} with this id belongs to the account`);

/**
 * @param {object} options
 * @param {object} options.accounts account store (server/accounts)
 * @param {object} options.ledger credit ledger store sharing the account database
 * @param {object} options.rewards contribution reward store
 * @param {object} options.guards session guards from composeAccountServices
 * @param {object} [options.communityAccess] Community Access store, for pool funding
 * @param {Function} [options.quoteTerms] ({ accountId, deviceId, request }) -> { service, pricing, terms }:
 *   the service and price policy behind quotes; clients never author terms. Without it quotes fail closed.
 * @param {object} [options.operatorAuthority] { authenticate({ token }) -> { actorId, roles } | null };
 *   without it operator routes fail closed
 * @param {object} options.limits explicit body and rate limits (see http.js)
 * @param {object} options.idempotencyBackend transactional backend for Idempotency-Key bindings
 *   (createMemoryRouteBackend or createFirestoreRouteBackend in idempotency.js)
 * @param {object} [options.rateLimiter] { consume({ key, max, windowMs }) -> { allowed, resetAt } }
 * @param {object} [options.faultHooks] test-only failure injection at the binding boundaries:
 *   afterComponent({ routeId }) once the component returned, before the response is stored;
 *   afterComplete({ routeId }) once it is stored, before it is sent
 */
export function createEarningRouter({
  accounts, ledger, rewards, guards, communityAccess = null, quoteTerms = null, operatorAuthority = null,
  limits, idempotencyBackend, rateLimiter = null, nowMs = () => Date.now(), log = console, faultHooks = {}
} = {}) {
  for (const [name, port] of Object.entries({ accounts, ledger, rewards, guards, idempotencyBackend })) {
    if (!port || typeof port !== 'object') throw new TypeError(`earning routes need the composed ${name}`);
  }
  const bounds = validateRouteLimits(limits);
  const idempotency = createRouteIdempotency({ backend: idempotencyBackend, leaseMs: bounds.idempotencyLeaseMs, nowMs });
  const limiter = rateLimiter ?? createMemoryRateLimiter({ nowMs });
  if (typeof limiter.consume !== 'function') throw new TypeError('rateLimiter must provide consume({ key, max, windowMs })');
  const parsers = {
    json: express.json({ limit: bounds.jsonBytes, strict: true }),
    evidence: express.json({ limit: bounds.evidenceJsonBytes, strict: true })
  };
  const count = (res, key, limit) => consumeRate(limiter, res, { key, ...limit, nowMs });
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  /** Authenticate, count, then parse: unauthenticated callers never reach a body parser. */
  const authenticate = async (req, res, auth) => {
    await count(res, `address:${req.ip ?? 'unknown'}`, bounds.address);
    if (auth === 'none') return {};
    if (auth.operator) {
      const operator = await authenticateOperator(operatorAuthority, req, auth.operator);
      await count(res, `operator:${operator.actorId}`, bounds.operator);
      return { operator, caller: { operatorId: operator.actorId } };
    }
    const token = bearerToken(req);
    if (!token) refuse(401, 'session_required', 'a session bearer token is required');
    const session = auth === 'device' ? await accounts.authorizeDevice(token) : await accounts.authenticate(token);
    await count(res, `account:${session.accountId}`, bounds.account);
    if (auth === 'device') await count(res, `device:${session.deviceId}`, bounds.device);
    return {
      token, sessionId: session.sessionId, accountId: session.accountId, deviceId: session.deviceId, ownerId: session.ownerId,
      caller: auth === 'device' ? { accountId: session.accountId, deviceId: session.deviceId } : { accountId: session.accountId }
    };
  };

  const parse = (req, res, kind) => new Promise((resolve, reject) => {
    // A body parsed upstream escaped this router's limits; refuse rather than trust it.
    if (req._body) {
      reject(Object.assign(new Error('ingress_misconfigured'), { route: true }));
      return;
    }
    if (hasBody(req) && !req.is('application/json')) {
      reject(Object.assign(new Error('json_required'), { route: true }));
      return;
    }
    parsers[kind](req, res, (error) => (error ? reject(error) : resolve()));
  });

  /** Register one route: `spec.auth` names its authentication, `spec.body` its parser (json or evidence). */
  const define = (method, path, spec, handler) => {
    router[method](path, (req, res, next) => {
      (async () => {
        if (spec.signIn) await count(res, `sign-in:${req.ip ?? 'unknown'}`, bounds.signIn);
        const ctx = await authenticate(req, res, spec.auth);
        if (spec.body) {
          try {
            await parse(req, res, spec.body);
          } catch (error) {
            if (error.route && error.message === 'ingress_misconfigured') {
              refuse(500, 'ingress_misconfigured', 'earning routes must parse their own bounded bodies; mount them before any general body parser');
            }
            if (error.route) refuse(415, 'json_required', 'this route accepts an application/json body');
            throw error;
          }
        }
        const { status = 200, body, replayed = false } = await handler(req, { ...ctx, routeId: `${method.toUpperCase()} ${path}` });
        if (replayed) res.setHeader('Idempotent-Replayed', 'true');
        res.status(status).json(body);
      })().catch(next);
    });
  };

  /**
   * Bind the Idempotency-Key to this route, the authenticated caller and the
   * canonical request (path parameters and validated body), then run with the
   * component key derived from the request. A completed request replays its
   * stored response. A failure frees the key only when it definitely had no
   * effect: a route refusal (always raised before the component acts) or, for
   * an `atomic` single-transaction operation, a coded component refusal.
   * Anything else is ambiguous and keeps the key as unknown, so the retry
   * reconciles through the component's idempotency under the same key.
   */
  const keyed = async (req, ctx, body, run, { atomic = true } = {}) => {
    const binding = await idempotency.begin({ routeId: ctx.routeId, caller: ctx.caller, key: idempotencyKeyOf(req), request: { params: { ...req.params }, body } });
    if (binding.replay) return { ...binding.replay, replayed: true };
    let response;
    try {
      response = await run(binding.componentKey, binding);
      await faultHooks.afterComponent?.({ routeId: ctx.routeId });
      await binding.complete(response);
    } catch (error) {
      const definite = error instanceof RouteError || (atomic && isComponentRefusal(error));
      try {
        await (definite ? binding.release() : binding.markUnknown());
      } catch (cause) {
        // The binding stays pending under this lease; a retry after it expires reconciles.
        log.error?.('[Earning routes] idempotency binding not updated:', cause);
      }
      throw error;
    }
    await faultHooks.afterComplete?.({ routeId: ctx.routeId });
    return response;
  };

  const ownReservation = async (reservationId, accountId) => {
    const reservation = await ledger.getReservation(reservationId);
    if (!reservation || reservation.accountId !== accountId) notFound('reservation_not_found', 'reservation');
    return reservation;
  };
  const ownOffer = async (offerId, accountId) => {
    const offer = await rewards.getOffer(offerId);
    if (!offer || offer.accountId !== accountId) notFound('offer_not_found', 'offer');
    return offer;
  };
  const decided = (operator, decisionId) => ({ actorId: operator.actorId, decisionId });

  // Sign-in and recovery: a provider assertion only, counted per client address.
  define('post', '/accounts/sign-in', { auth: 'none', signIn: true, body: 'json' }, async (req) => {
    const { providerId, assertion } = bodyOf(req, ['providerId', 'assertion']);
    return { body: await accounts.signIn({ providerId, assertion }) };
  });
  define('post', '/accounts/recover', { auth: 'none', signIn: true, body: 'json' }, async (req) => {
    const { providerId, assertion } = bodyOf(req, ['providerId', 'assertion']);
    return { body: await accounts.recoverAccount({ providerId, assertion }) };
  });

  // Session routes for the session's own account.
  define('post', '/sessions/end', { auth: 'session' }, async (req, ctx) => ({ body: await accounts.endSession({ sessionToken: ctx.token }) }));
  define('get', '/accounts/me', { auth: 'session' }, async (req, ctx) => ({
    body: {
      session: { sessionId: ctx.sessionId, accountId: ctx.accountId, deviceId: ctx.deviceId },
      account: await accounts.getAccount(ctx.accountId)
    }
  }));
  define('post', '/devices/challenges', { auth: 'session' }, async (req, ctx) => ({
    status: 201, body: await accounts.createRegistrationChallenge({ sessionToken: ctx.token })
  }));
  define('post', '/devices', { auth: 'session', body: 'json' }, async (req, ctx) => {
    const body = bodyOf(req, ['proof', 'label', 'bindSession', 'sessionBinding']);
    return keyed(req, ctx, body, async (idempotencyKey) => ({
      status: 201, body: await accounts.registerDevice({ ...body, sessionToken: ctx.token, idempotencyKey })
    }));
  });
  define('get', '/devices', { auth: 'session' }, async (req, ctx) => ({ body: { devices: await accounts.listDevices(ctx.accountId) } }));
  define('delete', '/devices/:deviceId', { auth: 'session', body: 'json' }, async (req, ctx) => {
    const body = bodyOf(req, ['reason']);
    return keyed(req, ctx, body, async (idempotencyKey) => ({
      body: await accounts.revokeDevice({ sessionToken: ctx.token, deviceId: req.params.deviceId, reason: body.reason, idempotencyKey })
    }));
  });
  define('put', '/devices/:deviceId/owner-authorization', { auth: 'session', body: 'json' }, async (req, ctx) => {
    const body = bodyOf(req, ['ownerAuthorization']);
    return keyed(req, ctx, body, async (idempotencyKey) => ({
      body: await accounts.recordOwnerAuthorization({
        sessionToken: ctx.token, deviceId: req.params.deviceId, ownerAuthorization: body.ownerAuthorization, idempotencyKey
      })
    }));
  });

  // Spending: a session acting as an active registered device.
  define('post', '/quotes', { auth: 'device', body: 'json' }, async (req, ctx) => {
    const body = bodyOf(req, ['request']);
    if (typeof quoteTerms !== 'function') refuse(503, 'quote_terms_unconfigured', 'quotes need the service and price policy port');
    return keyed(req, ctx, body, async (idempotencyKey) => {
      // Terms come from the price policy at call time, so the ledger cannot compare retries itself.
      // The quote id derives from the request's component key: every attempt of the same request
      // reaches the same quote, and no other caller or request can reach it.
      const quoteId = `quote_${sha256Hex(idempotencyKey).slice(0, 32)}`;
      const existing = await ledger.getQuote(quoteId);
      if (existing) return { body: existing };
      const offered = await quoteTerms({ accountId: ctx.accountId, deviceId: ctx.deviceId, request: body.request ?? null });
      if (!offered || typeof offered !== 'object') refuse(422, 'quote_not_offered', 'no service is offered for this request');
      const { service, pricing, terms } = offered;
      try {
        return { status: 201, body: await guards.createQuote({ sessionToken: ctx.token, quoteId, service, pricing, terms, idempotencyKey }) };
      } catch (error) {
        // A concurrent retry of the same request created it first.
        const raced = ['quote_exists', 'idempotency_conflict'].includes(error?.code) ? await ledger.getQuote(quoteId) : null;
        if (raced?.accountId === ctx.accountId) return { body: raced };
        throw error;
      }
    });
  });
  define('post', '/quotes/:quoteId/accept', { auth: 'device', body: 'json' }, async (req, ctx) => {
    const body = bodyOf(req, ['quoteHash']);
    return keyed(req, ctx, body, async (idempotencyKey) => ({
      body: await guards.acceptQuote({ sessionToken: ctx.token, quoteId: req.params.quoteId, quoteHash: body.quoteHash, idempotencyKey })
    }));
  });
  define('post', '/reservations/:reservationId/attempts', { auth: 'device', body: 'json' }, async (req, ctx) => {
    const body = bodyOf(req, ['attemptId', 'recipients']);
    return keyed(req, ctx, body, async (idempotencyKey) => {
      await ownReservation(req.params.reservationId, ctx.accountId);
      return { body: await ledger.bindAttempt({ reservationId: req.params.reservationId, attemptId: body.attemptId, recipients: body.recipients, idempotencyKey }) };
    });
  });

  // Reads of the session's own credit account.
  define('get', '/balances', { auth: 'session' }, async (req, ctx) => {
    const account = await ledger.getAccount(ctx.accountId);
    if (!account) notFound('account_not_found', 'credit account');
    return { body: account };
  });
  define('get', '/reservations', { auth: 'session' }, async (req, ctx) => ({ body: { reservations: await ledger.listAccountReservations(ctx.accountId) } }));
  define('get', '/reservations/:reservationId', { auth: 'session' }, async (req, ctx) => ({ body: await ownReservation(req.params.reservationId, ctx.accountId) }));
  define('get', '/journal', { auth: 'session' }, async (req, ctx) => ({ body: { entries: await ledger.listJournal(ctx.accountId) } }));

  // Contribution: offers made to the account, acceptance and claims.
  define('get', '/offers/:offerId', { auth: 'session' }, async (req, ctx) => ({ body: await ownOffer(req.params.offerId, ctx.accountId) }));
  define('post', '/offers/:offerId/accept', { auth: 'session', body: 'json' }, async (req, ctx) => {
    const body = bodyOf(req, ['offerHash', 'ownerAuthorization']);
    return keyed(req, ctx, body, async (idempotencyKey) => ({
      body: await guards.acceptOffer({ ...body, sessionToken: ctx.token, offerId: req.params.offerId, idempotencyKey })
    }));
  });
  /**
   * A claim against one of the account's accepted offers, from a device-bound
   * session. Delivery claims name acquirer-submitted evidence by deliveryId or
   * carry it inline; either way validation re-checks every signature. Accepted
   * work is issued at once (offers pay on validation); an issuance the
   * authority declines stays pending for the operator's resume.
   */
  define('post', '/offers/:offerId/claims', { auth: 'device', body: 'evidence' }, async (req, ctx) => {
    const body = bodyOf(req, CLAIM_KEYS);
    if (body.deliveryId !== undefined && Object.keys(body).length !== 1) {
      refuse(400, 'invalid_body', 'a claim names a deliveryId or carries its evidence, not both');
    }
    return keyed(req, ctx, body, async (idempotencyKey) => {
      await ownOffer(req.params.offerId, ctx.accountId);
      let claim = body;
      if (body.deliveryId !== undefined) {
        const record = await rewards.getDeliveryEvidence(body.deliveryId);
        if (!record) refuse(404, 'delivery_not_found', 'no delivery evidence has this id');
        claim = record.evidence;
      }
      const validation = await rewards.validateWork({ ...claim, offerId: req.params.offerId, idempotencyKey });
      let issuance = null;
      if (validation.outcome === 'accepted') {
        try {
          issuance = await rewards.issueReward({ validationId: validation.validationId });
        } catch (error) {
          // A coded decline is a durable answer; anything else is ambiguous and reconciles on retry.
          if (!isComponentRefusal(error)) throw error;
          issuance = { validationId: validation.validationId, status: 'pending', code: error.code };
        }
      }
      // A reconciled retry reads the validation as it stands, issuance included.
      const current = (await rewards.getValidation(validation.validationId)) ?? validation;
      return { body: { validation: validationView(current), issuance } };
    });
  });
  /** A certified acquirer's evidence of a completed delivery, from the acquiring device's session. */
  define('post', '/deliveries', { auth: 'device', body: 'evidence' }, async (req, ctx) => {
    const evidence = bodyOf(req, DELIVERY_EVIDENCE_KEYS);
    const device = await accounts.getDevice(ctx.deviceId);
    if (device?.status !== 'active' || device.accountId !== ctx.accountId) refuse(401, 'session_device_revoked', 'the session device is not active');
    return {
      status: 201,
      body: await rewards.recordDeliveryEvidence({ submitter: { accountId: ctx.accountId, participantId: device.participantId }, evidence })
    };
  });

  // Operator routes: an operator credential with the named role; the actor comes from the credential.
  const funding = { operator: ['funding'] };
  const fundingReader = { operator: ['funding', 'audit'] };
  const linkReader = { operator: ['links', 'audit'] };
  define('post', '/operator/funding/commitments', { auth: funding, body: 'json' }, async (req, ctx) => {
    const body = bodyOf(req, COMMITMENT_KEYS);
    return keyed(req, ctx, body, async (idempotencyKey) => ({ status: 201, body: await ledger.recordFundingCommitment({ ...body, idempotencyKey }) }));
  });
  define('get', '/operator/funding/commitments/:commitmentId', { auth: fundingReader }, async (req) => {
    const commitment = await ledger.getFundingCommitment(req.params.commitmentId);
    if (!commitment) refuse(404, 'commitment_not_found', 'no funding commitment has this id');
    return { body: { commitment, allocations: await ledger.listFundingAllocations({ commitmentId: req.params.commitmentId }) } };
  });
  define('post', '/operator/funding/reward-reservations', { auth: funding, body: 'json' }, async (req, ctx) => {
    const body = bodyOf(req, ['fundingId', 'commitmentId', 'amount', 'commitmentAmount', 'categories', 'decisionId']);
    const { decisionId, ...reservation } = body;
    // Several transactions (record, allocate, activate): even a coded refusal may follow a commit.
    return keyed(req, ctx, body, async (idempotencyKey) => ({
      status: 201, body: await rewards.reserveFunding({ ...reservation, authority: decided(ctx.operator, decisionId), idempotencyKey })
    }), { atomic: false });
  });
  define('post', '/operator/funding/reward-reservations/:fundingId/release', { auth: funding, body: 'json' }, async (req, ctx) => {
    const { decisionId } = bodyOf(req, ['decisionId']);
    return { body: await rewards.releaseFunding({ fundingId: req.params.fundingId, authority: decided(ctx.operator, decisionId) }) };
  });
  define('post', '/operator/funding/community-pools', { auth: funding, body: 'json' }, async (req, ctx) => {
    const { decisionId, ...body } = bodyOf(req, ['fundingId', 'commitmentId', 'quantity', 'poolAccountId', 'commitmentAmount', 'decisionId']);
    if (typeof communityAccess?.recordFunding !== 'function') refuse(503, 'community_access_unconfigured', 'Community Access is not composed');
    return { status: 201, body: await communityAccess.recordFunding({ ...body, authority: decided(ctx.operator, decisionId) }) };
  });
  define('get', '/operator/funding/allocations', { auth: fundingReader }, async (req) => ({
    body: { allocations: await ledger.listFundingAllocations(typeof req.query.commitmentId === 'string' ? { commitmentId: req.query.commitmentId } : {}) }
  }));
  define('post', '/operator/reservations/:reservationId/settle', { auth: { operator: ['settlement'] }, body: 'json' }, async (req, ctx) => {
    const body = bodyOf(req, SETTLEMENT_KEYS);
    return keyed(req, ctx, body, async (idempotencyKey) => ({
      body: await ledger.settleReservation({ ...body, reservationId: req.params.reservationId, idempotencyKey })
    }));
  });
  define('post', '/operator/rewards/issuance/resume', { auth: { operator: ['issuance'] }, body: 'json' }, async (req) => {
    const { limit } = bodyOf(req, ['limit']);
    if (limit !== undefined && !(Number.isSafeInteger(limit) && limit > 0 && limit <= 1000)) refuse(400, 'invalid_body', 'limit must be an integer from 1 to 1000');
    return { body: { results: await rewards.resumeIssuance(limit === undefined ? {} : { limit }) } };
  });
  define('post', '/operator/links', { auth: { operator: ['links'] }, body: 'json' }, async (req, ctx) => {
    const body = bodyOf(req, ['kind', 'accountIds', 'evidenceId', 'note']);
    return keyed(req, ctx, body, async (idempotencyKey) => ({
      status: 201,
      body: await accounts.recordLink({ ...body, recordedBy: { authority: 'operator', id: ctx.operator.actorId }, idempotencyKey })
    }));
  });
  define('get', '/operator/accounts/:accountId/links', { auth: linkReader }, async (req) => ({ body: { links: await accounts.listLinks(req.params.accountId) } }));
  define('get', '/operator/accounts/:accountId/audit', { auth: { operator: ['audit'] } }, async (req) => ({ body: await ledger.auditAccount(req.params.accountId) }));
  define('get', '/operator/provenance/participants/:participantId', { auth: linkReader }, async (req) => {
    const provenance = await accounts.attributeParticipant({ participantId: req.params.participantId, at: req.query.at });
    if (!provenance) refuse(404, 'registration_not_found', 'no registration of this participant covers that time');
    return { body: provenance };
  });
  define('post', '/operator/provenance/custody-keys', { auth: linkReader, body: 'json' }, async (req) => {
    const { certificate, at } = bodyOf(req, ['certificate', 'at']);
    const provenance = await accounts.attributeCustodyKey({ certificate, at });
    if (!provenance) refuse(404, 'registration_not_found', 'no registration attributes this custody key at that time');
    return { body: provenance };
  });

  router.use((req, res) => res.status(404).json({ error: 'route_not_found', message: 'no earning route matches this method and path' }));
  router.use(earningErrorHandler(log));
  return router;
}

export default createEarningRouter;
