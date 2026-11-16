/** HTTP authentication, role binding and distributed admission limits. */


export const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export const isRealtimeRelayRequest = (req) => (
  /\/peer\/rooms\/[^/]+\/messages(?:\/|$)/.test(String(req.path || req.url || ''))
);

export const createPoolRateLimiter = ({
  store,
  scope,
  limits
} = {}) => {
  if (typeof store?.consumeRateLimit !== 'function') {
    throw new TypeError('Pool admission requires the store rate-limit contract');
  }
  return async (req, res, next) => {
    // Express resolves req.ip using the host's explicit trust-proxy policy.
    // Neither forwarded headers nor caller-supplied role labels establish a quota principal here.
    let identity = req.ip || req.socket?.remoteAddress || 'unknown';
    if (scope === 'principal') identity = req.poolAuth?.verified ? req.poolAuth.uid : null;
    if (identity === null) return next();
    const realtime = isRealtimeRelayRequest(req);
    const { maxRequests, windowMs } = limits[realtime ? 'realtime' : 'control'];
    const rateClass = realtime ? 'realtime-relay' : 'control';
    const key = JSON.stringify([scope, identity, rateClass]);
    const result = await store.consumeRateLimit({ key, maxRequests, bucketMs: windowMs });
    res.setHeader('X-RateLimit-Scope', scope);
    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, result.limit - result.count)));
    res.setHeader('X-RateLimit-Reset', String(result.resetAt));
    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil((Number(result.resetAt) - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'pool rate limit exceeded', retryable: true, retryAfter });
    }
    return next();
  };
};

export const extractBearerToken = (req) => {
  const header = req.headers.authorization || req.headers.Authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
};

export const isLoopbackRequest = (req) => {
  const address = String(req.ip || req.socket?.remoteAddress || '').trim().toLowerCase();
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
};

export const PUBLIC_AUTH_EXCEPTIONS = Object.freeze([
  { method: '*', path: '/peer/rooms', authorization: 'signed-peer-protocol' },
  { method: '*', prefix: '/peer/rooms/', authorization: 'signed-peer-protocol' },
  ...['/deployment/check', '/status', '/policies', '/config', '/adapter-canaries']
    .map(path => ({ method: 'GET', path, authorization: 'public-read' })),
  ...['/research/', '/adapter-canaries/']
    .map(prefix => ({ method: 'GET', prefix, authorization: 'public-read' }))
].map(Object.freeze));

export const effectivePoolAuthPolicy = ({ allowUnauthenticatedLocal, verifierConfigured }, req = null) => {
  const publicException = req === null ? null : PUBLIC_AUTH_EXCEPTIONS.find(rule => (
    (rule.method === '*' || rule.method === req.method)
    && (rule.path ? req.path === rule.path : req.path.startsWith(rule.prefix))
  )) || null;
  const localAddress = req !== null && isLoopbackRequest(req);
  const localDevelopment = !publicException && localAddress && allowUnauthenticatedLocal === true;
  let roleAuthorization = publicException?.authorization || 'route-specific-role-binding';
  if (req?.poolAuth?.localDevelopment === true) roleAuthorization = 'local-development-bypass';
  return {
    schema: 'poolday.http-auth-policy/v1',
    // Compatibility: this describes the protected-route default, not every route.
    required: true,
    protectedDefault: 'authentication-required',
    publicExceptions: PUBLIC_AUTH_EXCEPTIONS,
    localDevelopmentAllowed: allowUnauthenticatedLocal === true,
    localDevelopment: {
      configured: allowUnauthenticatedLocal === true,
      allowedAtRequestAddress: allowUnauthenticatedLocal === true && localAddress,
      eligibleForRequest: localDevelopment,
      appliedToRequest: req?.poolAuth?.localDevelopment === true
    },
    verifierConfigured: verifierConfigured === true,
    roleBinding: true,
    roleBindingExceptions: ['verified-coordinator-claim', 'explicit-loopback-development'],
    request: {
      publicException,
      authenticationRequired: !publicException && !localDevelopment,
      roleAuthorization
    }
  };
};

export const normalizeUid = (uid) => String(uid || '').replace(/[^a-z0-9_-]/gi, '_');

export const roleIdForUid = (role, uid) => `${role}_${normalizeUid(uid)}`;

export const authMatchesRoleId = (auth, role, roleId) => {
  if (hasCoordinatorClaim(auth)) return true;
  if (auth?.localDevelopment === true) return true;
  if (!auth?.verified || !auth.uid) return false;
  return roleId === roleIdForUid(role, auth.uid);
};

export const authMatchesAnyRoleId = (auth, roles, roleId) => {
  if (auth?.localDevelopment === true) return true;
  if (!auth?.verified || !auth.uid) return false;
  return roles.some((role) => authMatchesRoleId(auth, role, roleId));
};

export const requireBoundRole = (req, res, role, roleId) => {
  if (authMatchesRoleId(req.poolAuth, role, roleId)) return true;
  res.status(403).json({
    error: 'authenticated identity does not match requested pool role',
    expectedRole: role,
    requestedRoleId: roleId
  });
  return false;
};

export const requireBoundAnyRole = (req, res, roles, roleId) => {
  if (authMatchesAnyRoleId(req.poolAuth, roles, roleId)) return true;
  res.status(403).json({
    error: 'authenticated identity does not match requested pool role',
    expectedRoles: roles,
    requestedRoleId: roleId
  });
  return false;
};

export const canReadAdapterPublication = (req, publication = {}) => (
  publication.visibility === 'public'
  || hasCoordinatorClaim(req.poolAuth)
  || authMatchesRoleId(req.poolAuth, 'publisher', publication.publisher?.publisherId)
);

export const hasCoordinatorClaim = (auth) => auth?.decoded?.admin === true
  || auth?.decoded?.poolCoordinator === true
  || auth?.decoded?.coordinator === true;

export function registerPoolAdmission(router, { store, rateLimits, authOptions, verifyAuthToken }) {
  router.use(asyncRoute(createPoolRateLimiter({ store, scope: 'address', limits: rateLimits.address })));

  router.use(asyncRoute(async (req, res, next) => {
    const requestPolicy = effectivePoolAuthPolicy(authOptions, req);
    const routeRequiresAuth = requestPolicy.request.authenticationRequired;
    const localDevelopment = requestPolicy.localDevelopment.eligibleForRequest;
    const token = extractBearerToken(req);
    if (!token) {
      if (routeRequiresAuth) return res.status(401).json({ error: 'Firebase auth token required' });
      req.poolAuth = {
        verified: false,
        tokenPresent: false,
        localDevelopment
      };
      return next();
    }
    if (typeof verifyAuthToken !== 'function') {
      if (routeRequiresAuth) return res.status(503).json({ error: 'Firebase auth verifier unavailable' });
      req.poolAuth = {
        verified: false,
        tokenPresent: true,
        localDevelopment
      };
      return next();
    }
    try {
      const decoded = await verifyAuthToken(token);
      if (typeof decoded?.uid !== 'string' || !decoded.uid.trim() || decoded.uid.length > 512) {
        return res.status(401).json({ error: 'Firebase auth token has no valid subject' });
      }
      req.poolAuth = { verified: true, tokenPresent: true, uid: decoded.uid, decoded };
      return next();
    } catch (error) {
      return res.status(401).json({ error: 'Firebase auth token invalid', reason: error.message });
    }
  }));

  router.use(asyncRoute(createPoolRateLimiter({ store, scope: 'principal', limits: rateLimits.principal })));
}
