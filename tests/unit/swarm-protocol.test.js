import { it, expect } from 'vitest';
import {
  allowsSwarmOrigin, boundIdentityError, discoveryJoinError, discoveryNamespace, forwardedNegotiation,
  frameError, joinIdentityError, negotiationError, parseFrame
} from '../../server/swarm-protocol.js';
import policy from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };

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

const params = query => new URLSearchParams(query);
const token = 'p'.repeat(32);

it('binds public discovery to the bootstrap room and private rooms to their own names', () => {
  expect(discoveryNamespace(params('scope=public'), policy)).toEqual({ scope: 'public', roomId: policy.publicRoomId });
  expect(discoveryNamespace(params('scope=private&roomId=reploid-swarm-team'), policy)).toEqual({ scope: 'private', roomId: 'reploid-swarm-team' });
  for (const query of ['', 'scope=private', 'scope=public&roomId=reploid-swarm-team', `scope=private&roomId=${policy.publicRoomId}`, 'scope=other&roomId=reploid-swarm-team']) {
    expect(discoveryNamespace(params(query), policy), query).toBeNull();
  }
});

it('checks joins identically for the Node server and the Cloudflare adapter', () => {
  expect(joinIdentityError({ peerId: 'peer-a', roomId: 'reploid-swarm-team', token })).toBeNull();
  expect(joinIdentityError({ peerId: 'a', roomId: 'reploid-swarm-team', token })).toBe('peerId is invalid');
  expect(joinIdentityError({ peerId: 'peer-a', roomId: 'other', token })).toBe('roomId is invalid');
  expect(joinIdentityError({ peerId: 'peer-a', roomId: 'reploid-swarm-team', token: 'short' })).toMatch(/capability/);
  expect(joinIdentityError({ peerId: 'peer-a', roomId: 'reploid-swarm-team', token: 'x'.repeat(1025) })).toMatch(/capability/);
  const publicNamespace = { scope: 'public', roomId: policy.publicRoomId };
  expect(discoveryJoinError(publicNamespace, { roomId: policy.publicRoomId, token: policy.publicJoinMarker }, policy)).toBeNull();
  expect(discoveryJoinError(publicNamespace, { roomId: policy.publicRoomId, token }, policy)).toBe('Public namespace required');
  const privateNamespace = { scope: 'private', roomId: 'reploid-swarm-team' };
  expect(discoveryJoinError(privateNamespace, { roomId: 'reploid-swarm-team', token: policy.publicJoinMarker }, policy)).toMatch(/Private/);
  expect(discoveryJoinError(privateNamespace, { roomId: 'reploid-swarm-other', token }, policy)).toBe('Connection namespace is fixed');
});

it('forwards only bound, well-formed negotiation payloads', () => {
  const bound = { peerId: 'peer-a', roomId: 'reploid-swarm-team' };
  expect(boundIdentityError({ peerId: 'peer-a' }, { peerId: null, roomId: bound.roomId })).toMatch(/Join is required/);
  expect(boundIdentityError({ peerId: 'peer-b' }, bound)).toMatch(/peerId/);
  expect(boundIdentityError({ peerId: 'peer-a', roomId: 'reploid-swarm-x' }, bound)).toMatch(/roomId/);
  expect(negotiationError({ type: 'offer', targetPeer: 'x' })).toBe('targetPeer is required');
  expect(negotiationError({ type: 'ice-candidate', targetPeer: 'peer-b', candidate: 'text' })).toBe('candidate payload is required');
  const offer = { type: 'offer', peerId: 'peer-a', targetPeer: 'peer-b', offer: { sdp: 's' }, secret: 'never' };
  expect(negotiationError(offer)).toBeNull();
  expect(forwardedNegotiation(offer, 'peer-a')).toEqual({ type: 'offer', peerId: 'peer-a', targetPeer: 'peer-b', offer: { sdp: 's' } });
});

it('bounds frames before parsing them', () => {
  expect(frameError('{}', true, 10)).toMatchObject({ code: 1003 });
  expect(frameError('x'.repeat(11), false, 10)).toMatchObject({ code: 1009 });
  expect(frameError('{}', false, 10)).toBeNull();
  expect(parseFrame('{')).toMatchObject({ code: 1003 });
  expect(parseFrame('[]').error).toMatch(/JSON object/);
  expect(parseFrame('{"type":"join"}')).toEqual({ message: { type: 'join' } });
});
