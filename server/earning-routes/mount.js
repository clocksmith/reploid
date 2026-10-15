/**
 * @fileoverview Configuration switch and mount for the earning-loop routes.
 *
 * Off by default: the routes mount only when REPLOID_EARNING_ROUTES is
 * exactly `enabled`. The composition (stores, policies, sign-in providers,
 * quote terms, operator authority and limits) is the operator's, loaded from
 * the module REPLOID_EARNING_COMPOSITION names; this repository ships no
 * real provider, policy or credential. In production mode (NODE_ENV=production
 * or a Cloud Run K_SERVICE), the routes refuse to start without a sign-in
 * provider, with any provider marked testOnly (such as the local test
 * provider) or over memory stores. The routes mount at /v1 on the application
 * itself, never under /pool, so no local-development bypass reaches them, and
 * they must mount before any general JSON parser.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createEarningRouter } from './router.js';

export const EARNING_ROUTES_SWITCH = 'REPLOID_EARNING_ROUTES';
export const EARNING_COMPOSITION_MODULE = 'REPLOID_EARNING_COMPOSITION';
export const EARNING_ROUTES_PREFIX = '/v1';

export class EarningRoutesConfigError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EarningRoutesConfigError';
    this.code = code;
  }
}

const refuse = (code, message) => {
  throw new EarningRoutesConfigError(code, message);
};

export const isProductionMode = (env = {}) => env.NODE_ENV === 'production' || Boolean(env.K_SERVICE);

/** The switch: unset, empty or `disabled` keeps the routes off; anything but `enabled` is a configuration error. */
export function readEarningRoutesConfig(env = {}) {
  const value = env[EARNING_ROUTES_SWITCH];
  const production = isProductionMode(env);
  if (value === undefined || value === '' || value === 'disabled') return { enabled: false, production, compositionModule: null };
  if (value !== 'enabled') refuse('switch_invalid', `${EARNING_ROUTES_SWITCH} must be "enabled" or "disabled"`);
  return { enabled: true, production, compositionModule: env[EARNING_COMPOSITION_MODULE] || null };
}

/**
 * Refuse a composition that must not serve production: no sign-in provider,
 * any test-only provider, or memory-backed accounts, ledger or rewards.
 */
export function assertProductionComposition(composition) {
  const providers = composition?.accounts?.signInProviders;
  if (!Array.isArray(providers) || providers.length === 0) refuse('sign_in_provider_required', 'production earning routes need a configured sign-in provider');
  const testOnly = providers.filter((provider) => provider.testOnly === true).map((provider) => provider.providerId);
  if (testOnly.length) {
    refuse('test_sign_in_provider_in_production', `the test-only sign-in provider (${testOnly.join(', ')}) is not permitted in production`);
  }
  const memory = ['accounts', 'ledger', 'rewards'].filter((name) => composition[name]?.kind === 'memory');
  if (memory.length) refuse('memory_store_in_production', `production earning routes need durable stores; memory-backed: ${memory.join(', ')}`);
}

const importFromPath = (specifier) => import(pathToFileURL(path.resolve(specifier)).href);

/**
 * Mount the routes on `app` when the switch is on. Returns
 * { mounted: false } when off; throws EarningRoutesConfigError (and the
 * caller refuses to start) when the switch or composition is invalid.
 *
 * @param {object} app Express application
 * @param {object} [options]
 * @param {object} [options.env] environment (process.env)
 * @param {object} [options.composition] the composition, instead of loading the module
 * @param {Function} [options.importModule] module loader for REPLOID_EARNING_COMPOSITION
 */
export async function mountEarningRoutes(app, { env = process.env, composition = null, importModule = importFromPath, log = console } = {}) {
  const config = readEarningRoutesConfig(env);
  if (!config.enabled) return { mounted: false, production: config.production };
  let resolved = composition;
  if (!resolved) {
    if (!config.compositionModule) refuse('composition_required', `${EARNING_COMPOSITION_MODULE} must name the module that composes the earning routes`);
    const loaded = await importModule(config.compositionModule);
    const create = loaded?.createEarningComposition ?? loaded?.default;
    if (typeof create !== 'function') refuse('composition_invalid', 'the composition module must export createEarningComposition({ env, production })');
    resolved = await create({ env, production: config.production });
  }
  if (config.production) assertProductionComposition(resolved);
  app.use(EARNING_ROUTES_PREFIX, createEarningRouter({ log, ...resolved }));
  return {
    mounted: true,
    prefix: EARNING_ROUTES_PREFIX,
    production: config.production,
    signInProviders: (resolved.accounts?.signInProviders ?? []).map(({ providerId, testOnly }) => ({ providerId, testOnly }))
  };
}

export default mountEarningRoutes;
