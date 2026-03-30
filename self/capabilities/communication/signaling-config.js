/**
 * @fileoverview Shared signaling URL resolution for Reploid swarm transports.
 */

export const REPLOID_SIGNALING_URL_PARAM = 'signaling';
export const REPLOID_SIGNALING_URL_STORAGE_KEY = 'REPLOID_SIGNALING_URL';
export const REPLOID_DEFAULT_SIGNALING_PATH = '/signaling';

const getLocationLike = (value = globalThis.window?.location || globalThis.location) => {
  if (!value) return null;
  if (typeof value.href === 'string' && value.href.trim()) return value;
  if (typeof value.protocol === 'string' && typeof value.host === 'string') {
    return {
      ...value,
      href: `${value.protocol}//${value.host}${value.pathname || '/'}${value.search || ''}${value.hash || ''}`
    };
  }
  return null;
};

const getBaseOrigin = (location) => {
  if (!location?.protocol || !location?.host) {
    return 'http://localhost';
  }
  return `${location.protocol}//${location.host}`;
};

const getSocketProtocol = (location) => (
  location?.protocol === 'https:' ? 'wss:' : 'ws:'
);

const looksLikeHost = (value) => (
  typeof value === 'string'
  && !value.includes('://')
  && !value.startsWith('/')
  && (
    value.includes(':')
    || value.includes('.')
    || value.startsWith('localhost')
    || value.startsWith('[')
  )
);

export function getDefaultSignalingUrl(locationInput = undefined) {
  const location = getLocationLike(locationInput);
  if (!location?.host) return null;
  return `${getSocketProtocol(location)}//${location.host}${REPLOID_DEFAULT_SIGNALING_PATH}`;
}

export function normalizeSignalingUrl(value, locationInput = undefined) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const location = getLocationLike(locationInput);
  const baseOrigin = getBaseOrigin(location);
  const socketProtocol = getSocketProtocol(location);
  let candidate = raw;

  if (candidate.startsWith('//')) {
    candidate = `${socketProtocol}${candidate}`;
  } else if (looksLikeHost(candidate)) {
    candidate = `${socketProtocol}//${candidate}`;
  }

  let parsed;
  try {
    parsed = new URL(candidate, baseOrigin);
  } catch {
    return null;
  }

  if (parsed.protocol === 'http:') {
    parsed.protocol = 'ws:';
  } else if (parsed.protocol === 'https:') {
    parsed.protocol = 'wss:';
  }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    return null;
  }

  if (!parsed.pathname || parsed.pathname === '/') {
    parsed.pathname = REPLOID_DEFAULT_SIGNALING_PATH;
  }

  parsed.hash = '';
  return parsed.toString();
}

export function getResolvedSignalingConfig(options = {}) {
  const win = options.win || globalThis.window;
  const storage = options.storage || win?.localStorage || globalThis.localStorage;
  const location = getLocationLike(options.location || win?.location || globalThis.location);
  const defaultUrl = getDefaultSignalingUrl(location);

  let queryValue = null;
  try {
    if (location?.href) {
      queryValue = new URL(location.href).searchParams.get(REPLOID_SIGNALING_URL_PARAM);
    }
  } catch {
    queryValue = null;
  }

  const candidates = [
    { source: 'query', value: queryValue },
    { source: 'global', value: win?.__REPLOID_SIGNALING_URL__ },
    {
      source: 'storage',
      value: typeof storage?.getItem === 'function'
        ? storage.getItem(REPLOID_SIGNALING_URL_STORAGE_KEY)
        : null
    }
  ];

  for (const candidate of candidates) {
    const url = normalizeSignalingUrl(candidate.value, location);
    if (url) {
      return {
        url,
        source: candidate.source,
        explicit: true
      };
    }
  }

  return {
    url: defaultUrl,
    source: 'default',
    explicit: false
  };
}

export default {
  REPLOID_DEFAULT_SIGNALING_PATH,
  REPLOID_SIGNALING_URL_PARAM,
  REPLOID_SIGNALING_URL_STORAGE_KEY,
  getDefaultSignalingUrl,
  getResolvedSignalingConfig,
  normalizeSignalingUrl
};
