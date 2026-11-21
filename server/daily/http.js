import express from 'express';
import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dayUTC, judgePrompt, scoreOutput } from './rules.js';

const COOKIE = 'reploid_daily_guest';
const commonTokens = fileURLToPath(new URL('../../apps/poolday/styles/poolday/tokens.css', import.meta.url));
const hostGuide = fileURLToPath(new URL('../../docs/daily-game.md', import.meta.url));
const problems = {
  'needs-invite': [403, 'Open the circle link from its host to play.'],
  'invalid-invite': [403, 'This circle invitation has expired or was revoked. Ask its host for a new link.'],
  'sign-in': [401, 'Verify your email to play in this circle.'],
  'host-full': [429, 'The host has reached its daily turn limit.'],
  'turn-limit': [429, 'You have used all three turns today.'],
  busy: [503, 'The host is serving another turn. Try again shortly.'],
  staged: [503, 'Ranked play is waiting for host qualification.'],
  'origin-denied': [403, 'Submit from this circle’s own page.'],
  'invalid-request': [400, 'Check the request and try again.'],
  'invalid-share': [400, 'Open a dare for today’s challenge or play today directly.'],
  'invalid-email': [400, 'Enter a valid email address.'],
  'invalid-code': [400, 'Enter the numeric code from your email.'],
  'auth-unavailable': [503, 'Email verification is temporarily unavailable.'],
  'code-rejected': [401, 'Email verification failed. Check your code and try again.'],
  'rate-limit': [429, 'Too many sign-in requests. Try again later.'],
  'request-conflict': [409, 'A different prompt already used this submission key.'],
  'day-closed': [409, 'Refresh to play today’s challenge.'],
  'unknown-attempt': [404, 'This turn is unavailable.'],
  'winning-attempt-required': [409, 'Only a completed winning turn can be shared.'],
  'turn-declined': [503, 'The provider could not accept the turn. Your try was returned.'],
  'turn-unresolved': [502, 'The provider may have received the turn. Check your recorded history.'],
  'turn-timeout': [504, 'The provider timed out. Check your recorded history before retrying.'],
  'configuration-changed': [409, 'The host configuration changed. Ranked play is paused for this challenge.'],
  'body-limit': [413, 'The request exceeds this circle’s size limit.'],
  'json-required': [415, 'Send an application/json request.'],
  'not-found': [404, 'This resource is unavailable.'],
  unavailable: [503, 'This circle is temporarily unavailable.'],
};
const storeProblems = {
  circle_invite_required: 'invalid-invite', guest_grant_required: 'sign-in',
  host_daily_limit: 'host-full', daily_attempt_limit: 'turn-limit', invalid_request_key: 'invalid-request',
  request_key_conflict: 'request-conflict', challenge_closed: 'day-closed', invalid_share: 'invalid-share',
  unknown_attempt: 'unknown-attempt', winning_attempt_required: 'winning-attempt-required',
  challenge_configuration_changed: 'configuration-changed',
};
class PublicProblem extends Error {
  constructor(code, message, status) {
    super(message ?? problems[code][1]);
    this.code = code;
    this.status = status ?? problems[code][0];
  }
}
const route = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
const loopback = host => ['127.0.0.1', '[::1]', 'localhost'].includes(host);
function verifiedOrigin(req, configured) {
  if (configured) return req.get('origin') === configured;
  try {
    const requestUrl = new URL(`${req.protocol}://${req.get('host')}`);
    return loopback(requestUrl.hostname) && requestUrl.origin === req.get('origin');
  } catch { return false; }
}
function fields(req, required, optional = []) {
  const obj = req.body;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || required.some(key => !Object.hasOwn(obj, key))
    || Object.keys(obj).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new PublicProblem('invalid-request');
  }
  return obj;
}
function tokenOf(req) {
  return (req.get('cookie') ?? '').split(';').map(value => value.trim()).find(value => value.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
}
function ownAttempt(attempt) {
  const { id, day, status, prompt, words, characters, attemptNumber, shareId, allowReveal, output, won, receiptDigest } = attempt;
  return { id, day, status, prompt, words, characters, attemptNumber, shareId, allowReveal, output, won, receiptDigest };
}
function projectChallenge(challenge, day) {
  if (!challenge) return null;
  if (challenge.day !== day || typeof challenge.target !== 'string' || !Array.isArray(challenge.banned)) throw new PublicProblem('staged');
  const { target, banned, modelId, modelIdentity, ruleVersion, digest } = challenge;
  return { day, target, banned, modelId, modelIdentity, ruleVersion, digest, qualified: challenge.qualified === true };
}

// Bounds both email sends and OTP guessing for this circle, across browser sessions.
function authLimits(clock) {
  const salt = randomBytes(32), counts = new Map();
  let windowStart = clock();
  return (email, type) => {
    if (clock() - windowStart >= 900_000) { counts.clear(); windowStart = clock(); }
    const key = type + createHmac('sha256', salt).update(email).digest('hex');
    const total = counts.get(type) ?? 0, personal = counts.get(key) ?? 0;
    if (total >= 120 || personal >= (type === 'start' ? 3 : 8)) throw new PublicProblem('rate-limit');
    counts.set(type, total + 1); counts.set(key, personal + 1);
  };
}

export function createDailyApp({ store, gameForDay, run, identity, circleName, hostGuideUrl = '/host.html',
  clock = Date.now, staticRoot, origin, timeoutMs = 60_000 }) {
  let expectedOrigin;
  if (origin) {
    const url = new URL(origin);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback(url.hostname)))) {
      throw new Error('Use a dedicated HTTPS origin or a loopback HTTP origin.');
    }
    expectedOrigin = url.origin;
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  const limitAuth = authLimits(clock);
  let busy = false;
  function inviteFor(req) {
    const token = req.get('x-circle-invite');
    if (!token) throw new PublicProblem('needs-invite');
    const invite = store.resolveCircle(token);
    if (!invite) throw new PublicProblem('invalid-invite');
    return invite;
  }
  function current({ forReplay = false } = {}) {
    const day = dayUTC(clock());
    const entry = gameForDay(day);
    const challenge = projectChallenge(entry, day);
    if (challenge?.qualified) {
      try { store.pinChallenge({ day, digest: entry.digest, challenge }); }
      catch (error) {
        if (!forReplay || error.code !== 'challenge_configuration_changed') throw error;
        return {day, challenge:{...store.storedChallenge(day),qualified:false}, paused:true};
      }
    }
    return { day, challenge };
  }
  const ready = challenge => challenge?.qualified && typeof run === 'function';
  app.use((req, res, next) => {
    res.set({ 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
      'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
    next();
  });
  const body = express.json({ limit: '4kb', strict: true });
  app.use('/api', (req, res, next) => {
    if (req.method !== 'POST') return next();
    if (!verifiedOrigin(req, expectedOrigin)) return next(new PublicProblem('origin-denied'));
    if (!req.is('application/json')) return next(new PublicProblem('json-required'));
    try { inviteFor(req); } catch (error) { return next(error); }
    return body(req, res, next);
  });

  app.get('/api/today', route((req, res) => {
    const { day, challenge, paused } = current({forReplay:true});
    const invite = req.get('x-circle-invite'), inviteValid = Boolean(store.resolveCircle(invite));
    const token = tokenOf(req), authenticated = inviteValid && Boolean(store.guest(token));
    const capacity = store.capacity(day);
    const share = typeof req.query.share === 'string' && /^[\w-]{43}$/.test(req.query.share) ? store.readShare(req.query.share) : null;
    if (share && req.method === 'GET') store.recordDareOpen(share.id);
    const shareChallenge = share ? store.storedChallenge(share.day) : null;
    let availability = 'ready';
    if (paused) availability = 'configuration-changed';
    else if (!ready(challenge)) availability = 'staged';
    else if (!inviteValid) availability = invite ? 'invalid-invite' : 'needs-invite';
    else if (capacity.used >= capacity.cap) availability = 'host-full';
    else if (busy) availability = 'busy';
    const yesterday = dayUTC(clock() - 86400_000);
    const revealChoices = authenticated ? store.history(token, yesterday)
      .filter(attempt => attempt.allowReveal && attempt.shareId)
      .map(({id, prompt}) => ({id, prompt})) : [];
    res.json({ challenge, shareChallenge, revealChoices, circle: circleName, hostGuideUrl, capacity, availability, inviteValid,
      authenticated, leaderboard: (challenge?.qualified || paused) ? store.leaderboard(day) : [], yesterdayWinners: store.yesterdayWinners(),
      history: authenticated ? store.history(token, day).map(ownAttempt) : [], share });
  }));

  for (const type of ['start', 'verify']) {
    app.post('/api/auth/' + type, route(async (req, res) => {
      const { email: value, code } = fields(req, type === 'start' ? ['email'] : ['email', 'code']);
      if (typeof value !== 'string' || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) throw new PublicProblem('invalid-email');
      if (type === 'verify' && (typeof code !== 'string' || !/^\d{6,10}$/.test(code))) throw new PublicProblem('invalid-code');
      if (typeof identity?.[type] !== 'function') throw new PublicProblem('auth-unavailable');
      const email = value.trim().toLowerCase();
      limitAuth(email, type);
      let subject;
      try {
        if (type === 'start') { await identity.start(email); return res.json({ ok: true }); }
        const verified = await identity.verify(email, code);
        subject = typeof verified === 'string' ? verified : verified?.subject;
      } catch (error) {
        if (error?.status === 429) throw new PublicProblem('rate-limit');
        throw new PublicProblem(type === 'verify' && error?.status < 500 ? 'code-rejected' : 'auth-unavailable');
      }
      if (typeof subject !== 'string' || !subject) throw new PublicProblem('code-rejected');
      const invite = inviteFor(req);
      const expiresAt = Math.min(invite.expiresAt, Number(clock()) + 30 * 86400_000);
      const grant = store.authorizeGuest({ subject, expiresAt });
      res.cookie(COOKIE, grant.token, { httpOnly: true, secure: (expectedOrigin ?? req.get('origin')).startsWith('https:'),
        sameSite: 'strict', path: '/', maxAge: expiresAt - Number(clock()) });
      return res.json({ authenticated: true });
    }));
  }

  app.post('/api/attempt', route(async (req, res) => {
    const { day, digest, prompt, key, via = null } = fields(req, ['day','digest','prompt','key'], ['via']);
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || typeof digest !== 'string' || !digest || digest.length > 256
      || typeof key !== 'string' || !/^[\w.:-]{1,128}$/.test(key) || (via !== null && (typeof via !== 'string' || !/^[\w-]{43}$/.test(via)))) {
      throw new PublicProblem('invalid-request');
    }
    const token = tokenOf(req), invite = req.get('x-circle-invite');
    if (!store.guest(token)) throw new PublicProblem('sign-in');
    const remaining = () => Math.max(0, 3 - store.history(token, day).length);
    const replay = attempt => {
      const pending = ['pending', 'dispatched'].includes(attempt.status);
      return res.status(pending ? 202 : 200).json({ attempt: ownAttempt(attempt), created: false, remaining: remaining() });
    };
    if (day !== dayUTC(clock())) {
      const archived = store.storedChallenge(day);
      if (archived?.digest === digest && typeof prompt === 'string') {
        const previous = store.existingAttempt({ token, day, key, prompt: prompt.trim().normalize('NFC'), via });
        if (previous) return replay(previous);
      }
      throw new PublicProblem('day-closed');
    }
    const { challenge } = current();
    if (!ready(challenge)) throw new PublicProblem('staged');
    if (digest !== challenge.digest) throw new PublicProblem('configuration-changed');
    let judged;
    try { judged = judgePrompt(prompt, challenge.target); } catch (error) { throw new PublicProblem('invalid-request', error.message); }
    const { created, attempt } = store.reserve({ token, invite, day, key, ...judged, via });
    if (!created) return replay(attempt);
    if (busy) { store.release(attempt.id); throw new PublicProblem('busy'); }
    busy = true;
    let dispatched = false;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, timeoutMs);
    timer.unref(); res.once('close', abort);
    const interrupted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new PublicProblem('turn-timeout')), { once: true }));
    // The HTTP wait can time out first. Only the adapter can settle whether the
    // provider could have received the prompt and when this hardware is idle again.
    const operation = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        const result = await run({ prompt: judged.prompt, signal: controller.signal, onDispatch() {
          controller.signal.throwIfAborted();
          inviteFor(req);
          if (!store.guest(token)) throw new PublicProblem('sign-in');
          if (dayUTC(clock()) !== day) throw new PublicProblem('day-closed');
          if (dispatched || !store.markDispatched(attempt.id)) throw new PublicProblem('turn-unresolved');
          dispatched = true;
        } });
        if (!dispatched) throw new Error('Missing dispatch acknowledgement');
        const completed = store.complete(attempt.id, { output: result.output,
          won: scoreOutput(result.output, challenge.target), receipt: result.receipt });
        return ownAttempt(completed);
      } catch (error) {
        if (dispatched || error?.dispatched === true) {
          store.markUnresolved(attempt.id);
          throw new PublicProblem('turn-unresolved');
        }
        store.release(attempt.id);
        if (error instanceof PublicProblem) throw error;
        throw new PublicProblem('turn-declined');
      } finally {
        busy = false;
        clearTimeout(timer); res.removeListener('close', abort);
      }
    });
    const result = await Promise.race([operation, interrupted]);
    // The invite/session may expire while a provider is running. Keep the result
    // in the ledger and require an authorized session before returning the prompt.
    inviteFor(req);
    if (!store.guest(token)) throw new PublicProblem('sign-in');
    return res.status(201).json({ attempt: result, created, remaining: remaining() });
  }));
  app.post('/api/share', route((req, res) => {
    const { attemptId, allowReveal } = fields(req, ['attemptId'], ['allowReveal']);
    if (typeof attemptId !== 'string' || attemptId.length > 128 || (allowReveal !== undefined && typeof allowReveal !== 'boolean')) throw new PublicProblem('invalid-request');
    inviteFor(req);
    res.json({ share: store.publish(tokenOf(req), attemptId, { allowReveal }) });
  }));

  if (staticRoot) {
    for (const filename of ['index.html','app.js','style.css','host.html']) {
      const paths = filename === 'index.html' ? ['/','/index.html'] : '/' + filename;
      app.get(paths, (req, res) => res.sendFile(filename, { root: staticRoot }));
    }
    app.get('/host-guide.txt', (req, res) => res.type('text/plain').sendFile(hostGuide));
    app.get('/pool-tokens.css', (req, res) => res.sendFile(commonTokens));
  }
  app.use((req, res, next) => next(new PublicProblem('not-found')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (res.destroyed) return;
    let problem = error;
    if (!(error instanceof PublicProblem)) {
      const code = storeProblems[error.code] ?? ({ 'entity.too.large': 'body-limit', 'entity.parse.failed': 'invalid-request',
        'encoding.unsupported': 'json-required', 'charset.unsupported': 'json-required' })[error.type];
      problem = new PublicProblem(code ?? (error.status === 404 ? 'not-found' : 'unavailable'));
    }
    res.status(problem.status).json({ error: problem.code, message: problem.message });
  });
  return app;
}
