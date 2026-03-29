/**
 * @fileoverview Unit tests for signaling URL resolution.
 */

import { describe, expect, it } from 'vitest';
import {
  getDefaultSignalingUrl,
  getResolvedSignalingConfig,
  normalizeSignalingUrl
} from '../../src/capabilities/communication/signaling-config.js';

describe('signaling-config', () => {
  const location = {
    href: 'http://localhost:8000/?swarm=openclaw',
    protocol: 'http:',
    host: 'localhost:8000',
    pathname: '/',
    search: '?swarm=openclaw',
    hash: ''
  };

  it('builds the default same-origin signaling URL', () => {
    expect(getDefaultSignalingUrl(location)).toBe('ws://localhost:8000/signaling');
  });

  it('normalizes http URLs to websocket URLs', () => {
    expect(normalizeSignalingUrl('http://127.0.0.1:8787', location))
      .toBe('ws://127.0.0.1:8787/signaling');
  });

  it('normalizes bare loopback host values', () => {
    expect(normalizeSignalingUrl('127.0.0.1:8787', location))
      .toBe('ws://127.0.0.1:8787/signaling');
  });

  it('resolves explicit query overrides before storage', () => {
    const config = getResolvedSignalingConfig({
      location: {
        ...location,
        href: 'http://localhost:8000/?swarm=openclaw&signaling=http://127.0.0.1:8787',
        search: '?swarm=openclaw&signaling=http://127.0.0.1:8787'
      },
      storage: {
        getItem: (key) => (key === 'REPLOID_SIGNALING_URL' ? 'ws://localhost:9999/signaling' : null)
      }
    });

    expect(config).toEqual({
      url: 'ws://127.0.0.1:8787/signaling',
      source: 'query',
      explicit: true
    });
  });

  it('falls back to storage when no query override exists', () => {
    const config = getResolvedSignalingConfig({
      location,
      storage: {
        getItem: (key) => (key === 'REPLOID_SIGNALING_URL' ? 'ws://127.0.0.1:8787/reploid-signal' : null)
      }
    });

    expect(config).toEqual({
      url: 'ws://127.0.0.1:8787/reploid-signal',
      source: 'storage',
      explicit: true
    });
  });

  it('returns the default config when no override is present', () => {
    const config = getResolvedSignalingConfig({
      location,
      storage: { getItem: () => null }
    });

    expect(config).toEqual({
      url: 'ws://localhost:8000/signaling',
      source: 'default',
      explicit: false
    });
  });
});
