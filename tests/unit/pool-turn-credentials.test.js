import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  TURN_CREDENTIAL_SCHEMA,
  createTurnRtcConfiguration,
  getPublicTurnServiceStatus
} from '../../server/pool/turn-credentials.js';

const env = Object.freeze({
  REPLOID_TURN_HOST: '203.0.113.10',
  REPLOID_TURN_SHARED_SECRET: 'unit-test-shared-secret',
  REPLOID_TURN_CREDENTIAL_TTL_SECONDS: '600'
});

describe('Pool TURN credentials', () => {
  it('creates coturn REST credentials without exposing the shared secret', () => {
    const result = createTurnRtcConfiguration({
      subject: 'firebase-user',
      now: Date.UTC(2026, 6, 28, 12, 0, 0),
      env
    });

    expect(result.schema).toBe(TURN_CREDENTIAL_SCHEMA);
    expect(result.ttlSeconds).toBe(600);
    expect(result.rtcConfig.iceTransportPolicy).toBe('all');
    const server = result.rtcConfig.iceServers[0];
    expect(server.urls).toEqual([
      'turn:203.0.113.10:3478?transport=udp',
      'turn:203.0.113.10:3478?transport=tcp',
      'turn:203.0.113.10:443?transport=tcp'
    ]);
    expect(server.username).toBe('1785240600:firebase-user');
    expect(server.credential).toBe(
      createHmac('sha1', env.REPLOID_TURN_SHARED_SECRET)
        .update(server.username)
        .digest('base64')
    );
    expect(JSON.stringify(result)).not.toContain(env.REPLOID_TURN_SHARED_SECRET);
  });

  it('reports only non-secret relay readiness', () => {
    expect(getPublicTurnServiceStatus(env)).toEqual({
      configured: true,
      credentialMode: 'turn_rest_ephemeral',
      ttlSeconds: 600,
      transports: ['udp:3478', 'tcp:3478', 'tcp:443']
    });
    expect(getPublicTurnServiceStatus({})).toMatchObject({ configured: false });
  });

  it('fails closed when relay authority is incomplete', () => {
    expect(() => createTurnRtcConfiguration({
      subject: 'firebase-user',
      env: { REPLOID_TURN_HOST: '203.0.113.10' }
    })).toThrow('TURN relay is not configured');
  });
});
