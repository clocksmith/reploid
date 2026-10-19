import { env, exports } from 'cloudflare:workers';
import { reset, evictDurableObject, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { afterEach, expect, it } from 'vitest';
import bootstrap from '../../self/config/swarm-bootstrap.json';
import policy from '../../server/cloudflare/policy.json';
import { generateKeyPair, SignJWT } from 'jose';
import { handleTurn, normalizeIceServers, verifyFirebase } from '../../server/cloudflare/turn.js';

const sockets = [];
afterEach(async () => { for (const ws of sockets.splice(0)) ws.close(); await reset(); });
const roomId = () => `reploid-swarm-${crypto.randomUUID()}`;
const join = (id, room = bootstrap.publicRoomId, token = bootstrap.publicJoinMarker) => ({ type: 'join', peerId: id, roomId: room, token });
async function connect(room = bootstrap.publicRoomId, scope = room === bootstrap.publicRoomId ? 'public' : 'private', origin = 'https://replo.id') {
  const response = await exports.default.fetch(`https://worker.test/swarm?scope=${scope}&roomId=${room}`, {
    headers: { Origin: origin, Upgrade: 'websocket' }
  });
  expect(response.status).toBe(101);
  const ws = response.webSocket, messages = [];
  ws.addEventListener('message', event => { messages.push(JSON.parse(event.data)); });
  ws.accept(); sockets.push(ws);
  return { ws, messages, send: value => ws.send(JSON.stringify(value)), async wait(type) {
    await expect.poll(() => messages.find(message => message.type === type)).toBeTruthy();
    return messages.find(message => message.type === type);
  } };
}

it('joins public discovery and forwards only same-namespace negotiation', async () => {
  const a = await connect(), b = await connect();
  a.send(join('peer-a')); expect((await a.wait('joined')).peers).toEqual([]);
  b.send(join('peer-b')); expect((await b.wait('joined')).peers).toEqual(['peer-a']);
  a.send({ type: 'offer', peerId: 'peer-a', targetPeer: 'peer-b', offer: { type: 'offer', sdp: 'test' } });
  expect((await b.wait('offer')).offer.sdp).toBe('test');
  a.send({ type: 'relay-message', peerId: 'peer-a', targetPeer: 'peer-b', envelope: { prompt: 'never-forward' } });
  expect((await a.wait('error')).error).toContain('does not relay');
  expect(b.messages.some(message => message.type === 'relay-message')).toBe(false);
});

it('preserves connected membership across hibernation and retires departure', async () => {
  const a = await connect(), b = await connect();
  a.send(join('peer-a')); await a.wait('joined'); b.send(join('peer-b')); await b.wait('joined');
  await evictDurableObject(env.ROOMS.getByName(`public:${bootstrap.publicRoomId}`));
  a.send({ type: 'offer', peerId: 'peer-a', targetPeer: 'peer-b', offer: { sdp: 'after-eviction' } });
  expect((await b.wait('offer')).offer.sdp).toBe('after-eviction');
  a.ws.close(); expect((await b.wait('peer-left')).peerId).toBe('peer-a');
});

it('isolates public/private namespaces and persists a private capability across eviction', async () => {
  const room = roomId(), token = 'a'.repeat(32), a = await connect(room), b = await connect();
  a.send(join('private-a', room, token)); await a.wait('joined');
  b.send(join('public-b')); expect((await b.wait('joined')).peers).toEqual([]);
  b.send({ type: 'offer', peerId: 'public-b', targetPeer: 'private-a', offer: {} });
  expect((await b.wait('error')).error).toContain('namespace');
  await evictDurableObject(env.ROOMS.getByName(`private:${room}`));
  const intruder = await connect(room); intruder.send(join('private-c', room, 'b'.repeat(32)));
  expect((await intruder.wait('error')).error).toContain('Unauthorized');
  const invited = await connect(room); invited.send(join('private-d', room, token));
  expect((await invited.wait('joined')).peers).toEqual(['private-a']);
});

it('rejects missing and mismatched origins and malformed namespace routing', async () => {
  for (const origin of ['', 'https://replo.id.evil.test']) {
    const response = await exports.default.fetch('https://worker.test/swarm?scope=public', { headers: { Origin: origin, Upgrade: 'websocket' } });
    expect(response.status).toBe(403);
  }
  for (const query of ['scope=private', 'scope=public&roomId=reploid-swarm-secret', 'scope=private&roomId=reploid-swarm-public']) {
    expect((await exports.default.fetch(`https://worker.test/swarm?${query}`, { headers: { Origin: 'https://replo.id', Upgrade: 'websocket' } })).status).toBe(400);
  }
});

it('rejects missing capabilities, cross-scope capabilities and duplicate identities', async () => {
  for (const [room, token] of [[roomId(), ''], [roomId(), bootstrap.publicJoinMarker], [bootstrap.publicRoomId, 'x'.repeat(32)]]) {
    const peer = await connect(room); peer.send(join('bad-peer', room, token)); await peer.wait('error');
    expect(peer.messages.some(message => message.type === 'joined')).toBe(false);
  }
  const a = await connect(), b = await connect();
  a.send(join('same-id')); await a.wait('joined'); b.send(join('same-id'));
  expect((await b.wait('error')).error).toContain('already connected');
});

it('bounds frames, binary messages and per-connection rates', async () => {
  const oversized = await connect(); oversized.ws.send('x'.repeat(65537));
  expect((await oversized.wait('error')).error).toContain('max size');
  const binary = await connect(); binary.ws.send(new Uint8Array(1));
  expect((await binary.wait('error')).error).toContain('Binary');
  const a = await connect(); a.send(join('rate-peer')); await a.wait('joined');
  const stub = env.ROOMS.getByName(`public:${bootstrap.publicRoomId}`);
  await runInDurableObject(stub, (instance, state) => {
    const ws = state.getWebSockets().find(socket => socket.deserializeAttachment().peerId === 'rate-peer');
    ws.serializeAttachment({ ...ws.deserializeAttachment(), count: 512, resetAt: Date.now() + 10000 });
  });
  a.send({ type: 'heartbeat', peerId: 'rate-peer' }); expect((await a.wait('error')).error).toContain('Rate limit');
});

it('expires unjoined connections and inactive peers through alarms', async () => {
  const room = roomId(), a = await connect(room), b = await connect(room);
  a.send(join('expiry-peer', room, 'e'.repeat(32))); await a.wait('joined');
  const closedA = new Promise(resolve => a.ws.addEventListener('close', resolve));
  const closedB = new Promise(resolve => b.ws.addEventListener('close', resolve));
  const stub = env.ROOMS.getByName(`private:${room}`);
  await runInDurableObject(stub, (instance, state) => {
    for (const ws of state.getWebSockets()) ws.serializeAttachment({ ...ws.deserializeAttachment(), connectedAt: 0, lastSeen: 0 });
  });
  await runDurableObjectAlarm(stub); await Promise.all([closedA, closedB]);
});

it('bounds shared admission and retains its counters after eviction', async () => {
  const admission = env.ADMISSION.getByName('bounded-admission-v1');
  const ids = await Promise.all(Array.from({ length: 129 }, () => admission.reserve('room')));
  expect(ids.filter(Boolean)).toHaveLength(128);
  await evictDurableObject(admission);
  expect(await admission.reserve('room')).toBeNull();
  await admission.release(ids[0]); expect(await admission.activate(ids[0])).toBe(false);
});

it('applies the shared peer cap independently of connection admission', async () => {
  const admission = env.ADMISSION.getByName('bounded-admission-v1');
  await runInDurableObject(admission, (instance, state) => {
    for (let i = 0; i < 256; i++) state.storage.sql.exec('INSERT INTO leases VALUES (?, ?, ?, 1)', `lease-${i}`, 'room', Date.now() + 90000);
  });
  const pending = await admission.reserve('room'); expect(pending).toBeTruthy();
  expect(await admission.activate(pending)).toBe(false);
  await admission.release('lease-0'); expect(await admission.activate(pending)).toBe(true);
});

it('retains fresh leases without writes across eviction, renews due leases, and never revives expired ones', async () => {
  const admission = env.ADMISSION.getByName('bounded-admission-v1');
  const id = await admission.reserve('room');
  expect(await admission.activate(id)).toBe(true);
  await evictDurableObject(admission);
  await runInDurableObject(admission, (instance, state) => {
    const sql = state.storage.sql;
    const initial = sql.exec('SELECT expires FROM leases WHERE id = ?', id).one().expires;
    const before = sql.exec('SELECT total_changes() AS n').one().n;
    expect(instance.renew([id])).toEqual([id]);
    expect(sql.exec('SELECT total_changes() AS n').one().n).toBe(before);
    expect(sql.exec('SELECT expires FROM leases WHERE id = ?', id).one().expires).toBe(initial);
    sql.exec('UPDATE leases SET expires = ? WHERE id = ?', Date.now() + 1000, id);
    expect(instance.renew([id])).toEqual([id]);
    expect(sql.exec('SELECT expires FROM leases WHERE id = ?', id).one().expires).toBeGreaterThan(Date.now() + policy.leaseMs - 1000);
    sql.exec('UPDATE leases SET expires = ? WHERE id = ?', Date.now() - 1, id);
    expect(instance.renew([id, 'missing'])).toEqual([]);
    expect(instance.activate(id)).toBe(false);
  });
});

it('bounds lease write amplification for eleven healthy peers over an hour', async () => {
  const admission = env.ADMISSION.getByName('write-budget');
  const result = await runInDurableObject(admission, (instance, state) => {
    const sql = state.storage.sql, originalNow = Date.now, start = originalNow();
    const ids = Array.from({ length: 11 }, (_, i) => `healthy-${i}`);
    for (const id of ids) sql.exec('INSERT INTO leases VALUES (?, ?, ?, 1)', id, 'room', start + policy.leaseMs);
    const before = sql.exec('SELECT total_changes() AS n').one().n;
    try {
      for (let elapsed = 30000; elapsed <= 3600000; elapsed += 30000) {
        Date.now = () => start + elapsed;
        expect(instance.renew(ids)).toEqual(ids);
      }
    } finally { Date.now = originalNow; }
    return { peers: ids.length, simulatedSeconds: 3600, leaseRowChanges: sql.exec('SELECT total_changes() AS n').one().n - before };
  });
  console.log(JSON.stringify({ event: 'lease-write-budget', ...result }));
  // At most one write per minute per peer; setup and alarm writes are separate.
  expect(result.leaseRowChanges).toBeLessThanOrEqual(result.peers * 60);
});

it('schedules healthy rooms less often while retaining earlier unjoined and inactive deadlines', async () => {
  const a = await connect(); a.send(join('scheduled-peer')); await a.wait('joined');
  const stub = env.ROOMS.getByName(`public:${bootstrap.publicRoomId}`);
  await runDurableObjectAlarm(stub);
  await runInDurableObject(stub, async (instance, state) => {
    expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now() + bootstrap.server.joinTimeoutMs);
  });
  await connect();
  await runInDurableObject(stub, async (instance, state) => {
    const now = Date.now();
    expect(await state.storage.getAlarm()).toBeLessThanOrEqual(now + bootstrap.server.joinTimeoutMs);
    for (const ws of state.getWebSockets()) {
      const meta = ws.deserializeAttachment();
      if (meta.peerId) meta.lastSeen = now - bootstrap.server.peerTimeout + 1000;
      else meta.connectedAt = now - bootstrap.server.joinTimeoutMs + 2000;
      ws.serializeAttachment(meta);
    }
  });
  await runDurableObjectAlarm(stub);
  await runInDurableObject(stub, async (instance, state) => {
    expect(await state.storage.getAlarm()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

it('rearms overdue room and admission alarms after failed delivery', async () => {
  for (const stub of [env.ROOMS.getByName(`public:${bootstrap.publicRoomId}`), env.ADMISSION.getByName('bounded-admission-v1')]) {
    await runInDurableObject(stub, async (instance, state) => {
      await state.storage.setAlarm(Date.now() - 60000);
      await instance.arm(bootstrap.server.joinTimeoutMs);
      expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now());
      const next = await state.storage.getAlarm();
      await instance.arm(bootstrap.server.heartbeatInterval);
      expect(await state.storage.getAlarm()).toBe(next);
    });
  }
});

it('a heartbeat restores missing cleanup without postponing an earlier alarm', async () => {
  const a = await connect(); a.send(join('heartbeat-recovery')); await a.wait('joined');
  const stub = env.ROOMS.getByName(`public:${bootstrap.publicRoomId}`);
  await runInDurableObject(stub, async (instance, state) => {
    const ws = state.getWebSockets().find(socket => socket.deserializeAttachment().peerId === 'heartbeat-recovery');
    await state.storage.deleteAlarm();
    await instance.webSocketMessage(ws, JSON.stringify({ type: 'heartbeat', peerId: 'heartbeat-recovery' }));
    expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now());
    const earlier = Date.now() + 1000;
    await state.storage.setAlarm(earlier);
    await instance.webSocketMessage(ws, JSON.stringify({ type: 'heartbeat', peerId: 'heartbeat-recovery' }));
    expect(await state.storage.getAlarm()).toBe(earlier);
  });
});

it('requires Firebase authentication for TURN and keeps failures uncached', async () => {
  for (const authorization of ['', 'Bearer invalid']) {
    const response = await exports.default.fetch('https://worker.test/rtc-config', { headers: { Origin: 'https://replo.id', Authorization: authorization } });
    expect(response.status).toBe(401); expect(response.headers.get('Cache-Control')).toBe('no-store');
  }
});

it('verifies Firebase signatures, issuer, audience, expiry and subject', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const now = Math.floor(Date.now() / 1000);
  const sign = claims => new SignJWT({ sub: 'test-user', aud: 'reploid', iss: 'https://securetoken.google.com/reploid', iat: now, auth_time: now, exp: now + 60, ...claims }).setProtectedHeader({ alg: 'RS256' }).sign(privateKey);
  expect(await verifyFirebase(await sign({}), 'reploid', publicKey)).toBe('test-user');
  for (const claims of [{ aud: 'other' }, { iss: 'https://evil.test' }, { exp: now - 1 }, { sub: '' }, { auth_time: now + 100 }]) {
    await expect(verifyFirebase(await sign(claims), 'reploid', publicKey)).rejects.toThrow();
  }
  const other = await generateKeyPair('RS256');
  await expect(verifyFirebase(await sign({}), 'reploid', other.publicKey)).rejects.toThrow();
});

const iceServers = [{ urls: ['stun:stun.cloudflare.com:3478'] }, { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:5349?transport=tcp'], username: 'short-lived', credential: 'ephemeral' }];
const turnRequest = () => new Request('https://worker.test/rtc-config', { headers: { Authorization: 'Bearer test' } });
const turnEnv = () => ({ ...env, TURN_KEY_ID: 'a'.repeat(32), TURN_KEY_SECRET: 'server-only-test-secret' });

it('returns short-lived relay credentials and retains TLS 5349 while excluding port 53', async () => {
  let outgoing;
  const response = await handleTurn(turnRequest(), turnEnv(), { verify: async () => 'verified-user', fetcher: async (url, options) => {
    outgoing = { url, options }; return Response.json({ iceServers }, { status: 201 });
  } });
  const payload = await response.json();
  expect(response.status).toBe(200); expect(payload.ttlSeconds).toBe(600);
  expect(payload.rtcConfig.iceTransportPolicy).toBe('all');
  expect(payload.rtcConfig.iceServers[1].urls).toContain('turns:turn.cloudflare.com:5349?transport=tcp');
  expect(payload.rtcConfig.iceServers[1].urls.some(url => /:53\?/.test(url))).toBe(false);
  expect(JSON.stringify(payload)).not.toContain('server-only-test-secret');
  expect(outgoing.options.redirect).toBe('manual'); expect(JSON.parse(outgoing.options.body)).toEqual({ ttl: 600 });
});

it('rejects untrusted relay URLs, missing credentials and oversized responses', async () => {
  expect(() => normalizeIceServers([{ urls: ['turn:evil.test:3478'], username: 'x', credential: 'y' }])).toThrow();
  expect(() => normalizeIceServers([{ urls: ['turn:turn.cloudflare.com:3478'] }])).toThrow();
  for (const fetcher of [async () => new Response('x'.repeat(16385)),
    async () => new Response('upstream secret detail', { status: 429 }),
    async () => new Response(null, { status: 302, headers: { Location: 'https://untrusted.invalid' } })]) {
    const response = await handleTurn(turnRequest(), turnEnv(), { verify: async () => 'verified-user', fetcher });
    expect(response.status).toBe(503); expect(response.headers.get('Retry-After')).toBe('10');
    expect(await response.text()).not.toContain('secret detail');
  }
});

it('rate limits credential issuance by verified subject', async () => {
  const admission = env.ADMISSION.getByName('bounded-admission-v1');
  for (let i = 0; i < 6; i++) expect(await admission.allowTurn('one-user')).toBe(true);
  const response = await handleTurn(turnRequest(), turnEnv(), { verify: async () => 'one-user', fetcher: async () => { throw new Error('must not execute'); } });
  expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('60');
  expect(await admission.allowTurn('another-user')).toBe(true);
});


it('shares the public room across hosted and arbitrary loopback origins without granting TURN', async () => {
  const hosted = await connect(); hosted.send(join('hosted')); await hosted.wait('joined');
  for (const [index, origin] of ['http://localhost:5173', 'https://localhost:9443', 'http://127.0.0.1:4321', 'http://[::1]:8081'].entries()) {
    const local = await connect(bootstrap.publicRoomId, 'public', origin);
    local.send(join(`local-${index}`)); expect((await local.wait('joined')).peers).toContain('hosted');
    const options = await exports.default.fetch('https://worker.test/rtc-config', { method: 'OPTIONS', headers: { Origin: origin } });
    expect(options.status).toBe(204); expect(options.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    const credentials = await exports.default.fetch('https://worker.test/rtc-config', { headers: { Origin: origin } });
    expect(credentials.status).toBe(401);
  }
});
