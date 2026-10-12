import { it, expect } from 'vitest';
import { allowsSwarmOrigin } from '../../server/swarm-origin-policy.js';
import policy from '../../self/config/swarm-bootstrap.json' with { type: 'json' };

it('admits hosted pages and canonical loopback origins on any port', () => {
  for (const origin of ['https://replo.id', 'http://localhost', 'http://localhost:5173', 'https://localhost:4443', 'http://127.0.0.1:32123', 'http://[::1]:65535']) {
    expect(allowsSwarmOrigin(origin, policy), origin).toBe(true);
  }
});
it('rejects lookalikes, LAN hosts, opaque origins and URLs with non-origin parts', () => {
  for (const origin of [null, '', 'null', 'https://evil.test', 'https://replo.id.evil.test', 'http://localhost.evil.test:8000', 'http://192.168.1.2:8000', 'http://localhost:5173/path', 'http://user@localhost:5173', 'http://localhost:5173?x=1', 'http://localhost:5173#x', 'ws://localhost:5173', 'file://localhost', 'http://127.1:5173']) {
    expect(allowsSwarmOrigin(origin, policy), String(origin)).toBe(false);
  }
  expect(allowsSwarmOrigin('http://localhost:5173', { ...policy, allowLoopbackOrigins: false })).toBe(false);
});
