/**
 * @fileoverview Scoped bearer authentication for the Change Passport service.
 */

import crypto from 'crypto';

const DEFAULT_LOCAL_ROLES = Object.freeze([
  'proposer',
  'evidence_producer',
  'evaluator',
  'security_reviewer',
  'change_authority',
  'activator',
  'observer',
  'rollback_authority'
]);

const bearerToken = (req) => {
  const header = req.headers.authorization || req.headers.Authorization;
  const match = typeof header === 'string' ? header.match(/^Bearer\s+(.+)$/i) : null;
  return match ? match[1].trim() : null;
};

const tokensEqual = (left, right) => {
  if (!left || !right) return false;
  const leftBytes = Buffer.from(String(left));
  const rightBytes = Buffer.from(String(right));
  return leftBytes.length === rightBytes.length && crypto.timingSafeEqual(leftBytes, rightBytes);
};

const isLoopback = (req) => {
  const address = String(req.ip || req.socket?.remoteAddress || '').toLowerCase();
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
};

const normalizePrincipal = (principal = {}) => ({
  subject: String(principal.subject || '').trim(),
  authorityId: String(principal.authorityId || principal.subject || '').trim(),
  organizationId: String(principal.organizationId || '').trim(),
  roles: [...new Set((Array.isArray(principal.roles) ? principal.roles : []).map(String).map((entry) => entry.trim()).filter(Boolean))],
  authenticationKind: String(principal.authenticationKind || 'bearer_token').trim()
});

export function parseChangeControlTokenConfig(value) {
  if (!value) return [];
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Change-control token configuration must be an object');
  }
  return Object.entries(parsed).map(([token, principal]) => ({
    token,
    principal: normalizePrincipal(principal)
  }));
}

export function createChangeControlAuthenticator({
  tokenEntries = [],
  allowUnauthenticatedLoopback = false,
  localOrganizationId = 'org:local'
} = {}) {
  const entries = tokenEntries.map((entry) => ({
    token: String(entry.token || ''),
    principal: normalizePrincipal(entry.principal)
  }));
  return (req, res, next) => {
    if (allowUnauthenticatedLoopback && isLoopback(req)) {
      req.changeControlAuth = {
        subject: 'loopback-development',
        authorityId: 'authority:loopback-development',
        organizationId: localOrganizationId,
        roles: [...DEFAULT_LOCAL_ROLES],
        authenticationKind: 'loopback_development'
      };
      return next();
    }
    const token = bearerToken(req);
    const match = entries.find((entry) => tokensEqual(token, entry.token));
    if (!match) return res.status(401).json({ error: 'Change Passport access token is required' });
    const principal = match.principal;
    if (!principal.subject || !principal.authorityId || !principal.organizationId || !principal.roles.length) {
      return res.status(503).json({ error: 'Change Passport principal configuration is incomplete' });
    }
    req.changeControlAuth = { ...principal, roles: [...principal.roles] };
    return next();
  };
}

export function requireChangeControlRole(auth, role) {
  if (!auth?.roles?.includes(role)) {
    const error = new Error(`Change Passport role required: ${role}`);
    error.statusCode = 403;
    throw error;
  }
  return auth;
}

export default {
  createChangeControlAuthenticator,
  parseChangeControlTokenConfig,
  requireChangeControlRole
};
