// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDailyStore } from '../../server/daily/store.js';
import { createDailyApp } from '../../server/daily/http.js';
import { openDailyDeviceKeys } from '../../server/daily/device-keys.js';
import { createTestDeviceKey } from '../fixtures/daily-device-key.mjs';

const firstDay = '2026-11-21';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

describe('daily circle HTTP boundary', () => {
  let time, store, invite, server, base, temp, game, runner, identity;
  const clock = () => time;
  beforeEach(() => {
    time = Date.parse(firstDay + 'T12:00:00Z');
    store = createDailyStore({ path: ':memory:', hostId: 'test-host', hostDailyCap: 7, now: clock });
    invite = store.circleInvite({ expiresAt: time + 4 * 86400000 });
    game = { qualified: true, target: 'Fine.', banned: ['fine'], modelId:'local-model', ruleVersion:'v1', digest:'pin-1', solution:'do not disclose' };
    runner = vi.fn(async ({ onDispatch }) => { onDispatch(); return { output: 'FINE!', receipt: { signature:'private-provider-evidence' } }; });
    identity = { start: vi.fn(async () => {}), verify: vi.fn(async (email, code) => code === '112233' ? 'account/' + email : null) };
    temp = mkdtempSync(join(tmpdir(), 'daily-http-'));
  });
  afterEach(async () => {
    if (server) { const stopped = once(server, 'close'); server.close(); server.closeAllConnections(); await stopped; server = undefined; }
    store.close(); rmSync(temp, { recursive: true, force:true });
  });
  async function start(options = {}) {
    const app = createDailyApp({ store, gameForDay: day => ({ ...game, day }), run: runner, identity,
      circleName:'test circle', clock, staticRoot:temp, ...options });
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    base = 'http://127.0.0.1:' + server.address().port;
  }
  async function post(path, value, cookie, extra = {}) {
    const response = await fetch(base + '/api/' + path, { method:'POST', headers:{ Origin:base, 'Content-Type':'application/json',
      'X-Circle-Invite':invite.token, ...(cookie ? { cookie } : {}), ...extra }, body:JSON.stringify(value) });
    return { status:response.status, json:await response.json(), cookie:response.headers.get('set-cookie') };
  }
  async function state(cookie, { via, circle = invite.token } = {}) {
    const response = await fetch(base + '/api/today' + (via ? '?share=' + via : ''), {
      headers:{ ...(cookie ? {cookie} : {}), ...(circle ? {'x-circle-invite':circle} : {}) },
    });
    return { status:response.status, json:await response.json() };
  }
  async function login(email = 'alice@example.test') {
    const check = await post('auth/verify', { email, code:'112233' });
    expect(check.json).toEqual({ authenticated:true }); expect(check.cookie).toMatch(/HttpOnly/); expect(check.cookie).toMatch(/SameSite=Strict/);
    return check.cookie.split(';')[0];
  }
  const turn = (cookie, key, more = {}) => post('attempt', { day:new Date(time).toISOString().slice(0,10), digest:game.digest, prompt:'Express agreement', key, ...more }, cookie);

  it('requires exact origin, verified identity and a host invite, caps input and OTP calls, and serves only permitted assets', async () => {
    writeFileSync(join(temp,'index.html'), 'circle home'); writeFileSync(join(temp,'host.html'), 'host instructions');
    writeFileSync(join(temp,'private.txt'), 'secret'); await start();
    expect((await state(null,{circle:null})).json.availability).toBe('needs-invite');
    expect((await state(null,{circle:'invalid'})).json.availability).toBe('invalid-invite');
    expect((await post('auth/start',{email:'a@b.example'},null,{Origin:'https://other.example'})).json.error).toBe('origin-denied');
    expect((await post('auth/start',{email:'a@b.example'},null,{'x-circle-invite':'invalid'})).json.error).toBe('invalid-invite');
    expect((await post('auth/start',{email:'a@b.example',subject:'forged'})).json.error).toBe('invalid-request');
    expect((await post('attempt', { prompt:'x'.repeat(4400), key:'a' })).status).toBe(413);
    expect((await turn(null, 'a')).json.error).toBe('sign-in');
    expect((await post('auth/verify',{email:'a@b.example',code:'998877'})).json.error).toBe('code-rejected');
    for (let i = 0; i < 3; i++) expect((await post('auth/start', {email:'A@b.example'})).json).toEqual({ok:true});
    expect((await post('auth/start',{email:'a@b.example'})).json.error).toBe('rate-limit');
    expect(identity.start).toHaveBeenCalledTimes(3); expect(runner).not.toHaveBeenCalled();
    expect(await (await fetch(base + '/')).text()).toBe('circle home'); expect(await (await fetch(base + '/host.html')).text()).toBe('host instructions');
    expect((await fetch(base + '/pool-tokens.css')).status).toBe(200); expect((await fetch(base + '/private.txt')).status).toBe(404);
  });

  it('judges on the server, persists private history, explicitly shares wins, and replays an archived dare without compute', async () => {
    await start(); const alice = await login(), bob = await login('bob@example.test');
    const staged = (await state(alice)).json;
    expect(staged).toMatchObject({ availability:'ready', circle:'test circle', hostGuideUrl:'/host.html', authenticated:true });
    expect(JSON.stringify(staged)).not.toContain(game.solution);
    expect((await turn(alice, 'a', {prompt:'fine'})).status).toBe(400);
    expect((await turn(alice, 'a', {won:true})).status).toBe(400);
    const first = await turn(alice, 'a');
    expect(first).toMatchObject({ status:201, json:{ created:true, remaining:4, attempt:{status:'completed',won:true,words:2}} });
    expect(first.json.attempt.receiptDigest).toMatch(/^sha256:/); expect(JSON.stringify(first)).not.toContain('private-provider-evidence');
    expect((await turn(alice,'a')).json).toMatchObject({created:false,attempt:first.json.attempt});
    expect((await turn(alice,'a',{prompt:'try again'})).json.error).toBe('request-conflict');
    expect((await state(alice, {circle:null})).json.history).toEqual([]); expect((await state(bob)).json.history).toEqual([]);
    expect((await post('share',{attemptId:first.json.attempt.id,allowReveal:true},bob)).status).toBe(404);
    const published = (await post('share',{attemptId:first.json.attempt.id,allowReveal:true},alice)).json.share;
    const publicGame = (await state(null,{via:published.id,circle:null})).json;
    expect(store.ownerStats().openedDares).toBe(1); expect(publicGame.activity).toBeUndefined();
    expect(publicGame.share).toEqual(published); expect(publicGame.leaderboard).toEqual([{rank:1,words:2,characters:17}]);
    expect(JSON.stringify(publicGame)).not.toContain('Express agreement'); expect(publicGame.yesterdayWinners).toEqual([]);
    store.reviewReveal(first.json.attempt.id); time += 86400000; game.target = 'No.'; game.banned = ['no'];
    const next = (await state(null,{via:published.id,circle:null})).json;
    expect(next.shareChallenge).toMatchObject({day:firstDay,target:'Fine.'}); expect(next.challenge.target).toBe('No.');
    const stale = { day:firstDay, digest:'pin-1' };
    expect((await turn(alice,'new-key', stale)).json.error).toBe('day-closed');
    expect((await turn(alice,'a',stale)).json).toMatchObject({created:false,attempt:{id:first.json.attempt.id},remaining:4});
    expect((await turn(alice,'a',{...stale,prompt:'a different request'})).json.error).toBe('request-conflict');
    expect(store.capacity(next.challenge.day).used).toBe(0);
    expect(next.share).toEqual(published); expect(next.yesterdayWinners).toEqual([{prompt:'Express agreement',words:2,characters:17}]);
    expect((await post('share',{attemptId:first.json.attempt.id,allowReveal:false},alice)).json.share.id).toBe(published.id);
    expect((await state()).json.yesterdayWinners).toEqual([]);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('replays pending submissions while a different key gets a refunded busy response, and keeps budgets across fresh cookies', async () => {
    const inside = deferred(), finish = deferred();
    runner.mockImplementationOnce(async ({ onDispatch }) => { onDispatch(); inside.resolve(); await finish.promise; return { output:'Fine.',receipt:{signed:true} }; });
    await start(); const alice = await login(); const one = turn(alice,'one'); await inside.promise;
    expect((await state(alice)).json.availability).toBe('busy'); expect(await turn(alice,'one')).toMatchObject({ status:202, json:{created:false} });
    expect((await turn(alice,'two')).json.error).toBe('busy'); expect(store.capacity(firstDay).used).toBe(1);
    finish.resolve(); expect((await one).status).toBe(201); expect((await turn(alice,'two')).status).toBe(201);
    const newCookie = await login(); expect(newCookie).not.toBe(alice); expect((await turn(newCookie,'three')).status).toBe(201);
    expect((await turn(newCookie,'four')).status).toBe(201); expect((await turn(newCookie,'five')).status).toBe(201);
    expect((await turn(newCookie,'six')).json.error).toBe('turn-limit');
    const bob = await login('bob@example.test'); await turn(bob,'one'); await turn(bob,'two');
    expect((await state(bob)).json.availability).toBe('host-full'); expect((await turn(bob,'three')).json.error).toBe('host-full');
    expect((await turn(bob,'one')).status).toBe(200); expect(runner).toHaveBeenCalledTimes(7);
  });

  it('keeps possibly dispatched turns and frees definitely declined ones, blocks stale qualifications and revoked invites', async () => {
    await start(); const alice = await login();
    runner.mockRejectedValueOnce(new Error('private fleet identity'));
    const declined = await turn(alice,'one'); expect(declined.json.error).toBe('turn-declined'); expect(JSON.stringify(declined)).not.toContain('private fleet identity');
    expect(store.capacity(firstDay).used).toBe(0);
    runner.mockRejectedValueOnce(Object.assign(new Error('ambiguous'), {dispatched:true}));
    expect((await turn(alice,'one')).json.error).toBe('turn-unresolved');
    expect((await turn(alice,'one')).json.attempt.status).toBe('unresolved'); expect(store.activity().players).toBe(1);
    runner.mockImplementationOnce(async ({onDispatch}) => { onDispatch(); throw new Error('interruption'); });
    expect((await turn(alice,'two')).json.error).toBe('turn-unresolved');
    game.digest = 'changed'; expect((await state()).json).toMatchObject({availability:'configuration-changed',challenge:{digest:'pin-1',qualified:false}});
    expect((await turn(alice,'three')).json.error).toBe('configuration-changed');
    game.qualified = false; expect((await state(alice)).json.availability).toBe('staged'); expect((await turn(alice,'three')).json.error).toBe('staged');
    game.qualified = true; game.digest = 'pin-1';
    expect((await turn(alice,'three')).json.attempt.attemptNumber).toBe(3);
    store.revokeCircle(invite.id);
    expect((await state(alice)).json.authenticated).toBe(false); expect((await turn(alice,'three')).json.error).toBe('invalid-invite');
    expect(store.capacity(firstDay).used).toBe(3);
  });

  it('keeps ranked staged while a separate, loopback-only playtest uses explicit stable host grants', async () => {
    game.qualified = false;
    const appArgs = {store, gameForDay:day => ({...game,day}), run:runner, mode:'playtest'};
    expect(() => createDailyApp(appArgs)).toThrow('matching score database');
    store.close(); store = createDailyStore({path:':memory:', hostId:'test-host', mode:'playtest', now:clock});
    invite = store.circleInvite({expiresAt:time+86400000});
    const player = store.authorizeGuest({subject:'owner-assigned-player', expiresAt:time+86400000});
    await start({mode:'playtest', identity:null, evidenceKind:'local-doppler'});
    expect((await state()).json).toMatchObject({mode:'playtest',authMode:'host-grant',availability:'ready',evidenceKind:'local-doppler',
      challenge:{qualified:false,playable:true},authenticated:false});
    expect((await post('auth/grant', {grant:invite.token})).json.error).toBe('grant-rejected');
    const auth = await post('auth/grant',{grant:player.token}); const cookie = auth.cookie.split(';')[0];
    expect(auth.json).toEqual({authenticated:true}); expect((await turn(cookie,'local-test')).status).toBe(201);
    expect((await post('auth/grant',{grant:player.token},null,{'x-forwarded-for':'192.0.2.8'})).status).toBe(403);
    expect((await state()).json.authenticated).toBe(false); expect((await state(cookie)).json.history.length).toBe(1);
  });

  it('isolates a public static frontend’s CORS, ceremony and partitioned sessions from the direct circle', async () => {
    const quick = 'https://backend.example', site = 'https://daily.example';
    const primary = { start:vi.fn(),finish:vi.fn() };
    const stable = { start:vi.fn(async () => ({grant:'ceremony',challenge:'daily-example-challenge'})),
      finish:vi.fn(async () => 'device/test-stable-guest') };
    await start({origin:quick,deviceKeys:primary,publicInvite:invite.token,trustedFrontends:new Map([[site,{deviceKeys:stable}]])});
    const preflight = (origin, headers = 'content-type,x-circle-invite') => fetch(base+'/api/attempt',{method:'OPTIONS',
      headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':headers}});
    const valid = await preflight(site);
    expect(valid.status).toBe(204);
    expect(valid.headers.get('access-control-allow-origin')).toBe(site);
    expect(valid.headers.get('access-control-allow-credentials')).toBe('true');
    expect(valid.headers.get('vary')).toContain('Origin');
    expect((await preflight(site,'authorization')).status).toBe(403);
    const other = await preflight('https://elsewhere.example');
    expect(other.status).toBe(403); expect(other.headers.has('access-control-allow-origin')).toBe(false);
    expect((await post('auth/grant',{grant:'test'},null,{Origin:site})).status).toBe(403);
    const registration = await post('auth/device/start',{},null,{Origin:site});
    expect(registration.json).toEqual({challenge:'daily-example-challenge'}); expect(primary.start).not.toHaveBeenCalled();
    expect(registration.cookie).toMatch(/^__Host-reploid_daily_device=ceremony;/);
    for (const flag of ['HttpOnly','Secure','Partitioned','SameSite=None','Path=/;']) expect(registration.cookie).toContain(flag);
    const signed = {publicKey:'test-key',signature:'test-signature'};
    expect((await post('auth/device/finish',signed,'reploid_daily_device=ceremony',{Origin:site})).json.error).toBe('session-storage');
    const done = await post('auth/device/finish',signed,'__Host-reploid_daily_device=ceremony',{Origin:site});
    expect(done.json.authenticated).toBe(true); expect(primary.finish).not.toHaveBeenCalled();
    expect(stable.finish).toHaveBeenLastCalledWith('ceremony',invite.id,signed);
    const session = done.cookie.match(/__Host-reploid_daily_guest=[^;]+/)[0];
    const read = async origin => (await fetch(base+'/api/today',{headers:{Origin:origin,Cookie:session}})).json();
    expect((await read(site)).authenticated).toBe(true); expect((await read(quick)).authenticated).toBe(false);
    expect((await read('https://elsewhere.example')).error).toBe('origin-denied');
  });

  it('uses a short-lived in-tab alias after device sign-in when the browser rejects the partitioned cookie', async () => {
    const quick = 'https://backend.example', site = 'https://daily.example';
    const once = 'x'.repeat(43);
    const stable = {start:vi.fn(async () => ({grant:once,challenge:'tab-challenge'})),finish:vi.fn(async value => {
      if (value !== once) throw Error('Unrecognized ceremony');
      return 'device/test-tab-guest';
    })};
    await start({origin:quick,deviceKeys:{},publicInvite:invite.token,trustedFrontends:new Map([[site,{deviceKeys:stable}]])});
    expect((await post('auth/device/start',{tabFallback:true},null,{Origin:quick})).status).toBe(400);
    const started = await post('auth/device/start',{tabFallback:true},null,{Origin:site});
    expect(started.json).toEqual({challenge:'tab-challenge',ceremony:once});
    const finish = (ceremony,cookie) => post('auth/device/finish',{publicKey:'test-key',signature:'test-signature',ceremony},cookie,{Origin:site});
    expect((await finish('wrong')).status).toBe(400);
    expect((await finish('y'.repeat(43))).status).toBe(401);
    expect((await finish(once,'__Host-reploid_daily_device='+'z'.repeat(43))).json.error).toBe('sign-in-failed');
    const {json} = await finish(once);
    expect(json.tabSession).toMatch(/^[\w-]{43}$/); expect(store.guest(json.tabSession)).toBeFalsy();
    const read = async (origin,inv = invite.token) => (await fetch(base+'/api/today',{headers:{Origin:origin,'x-circle-invite':inv,'x-daily-tab':json.tabSession}})).json();
    expect((await read(site)).authenticated).toBe(true);
    expect((await read(quick)).error).toBe('origin-denied');
    expect((await read('https://unrelated.example')).error).toBe('origin-denied');
    expect((await read(site,store.circleInvite({expiresAt:time+86400000}).token)).authenticated).toBe(false);
    time += 15 * 60_000;
    expect((await read(site)).authenticated).toBe(false);
    expect(store.capacity(firstDay).used).toBe(0);
  });

  it('signs in with a device key and refuses wrong keys and altered, reused, expired or other-origin challenges', async () => {
    const circle = 'https://circle.example', headers = {Origin:circle};
    const deviceKeys = openDailyDeviceKeys({file:':memory:',origin:circle,clock});
    const finishes = vi.spyOn(deviceKeys,'finish');
    try {
      await start({origin:circle,deviceKeys,identity:null});
      expect((await state()).json.authMode).toBe('device');
      const begin = async () => {
        const started = await post('auth/device/start',{},null,headers);
        expect(started.status).toBe(200); expect(started.json.challenge).toMatch(/^[\w-]{43}$/);
        expect(started.cookie).toMatch(/^reploid_daily_device=[\w-]{43};.*Path=\/api\/auth\/device/);
        return {challenge:started.json.challenge,cookie:started.cookie.split(';')[0]};
      };
      const finish = (payload,cookie) => post('auth/device/finish',payload,cookie,headers);
      const player = createTestDeviceKey(), stranger = createTestDeviceKey(), older = createTestDeviceKey('p256');

      const first = await begin();
      const signedIn = await finish(player.signIn(circle,first.challenge),first.cookie);
      expect(signedIn.status).toBe(200); expect(signedIn.json).toEqual({authenticated:true});
      expect((await state(signedIn.cookie.match(/reploid_daily_guest=[^;]+/)[0])).json.authenticated).toBe(true);
      const reused = await finish(player.signIn(circle,first.challenge),first.cookie);
      expect(reused.status).toBe(401); expect(reused.json.error).toBe('sign-in-failed');

      const again = await begin();
      expect((await finish(player.signIn(circle,again.challenge),again.cookie)).status).toBe(200);
      const subjects = await Promise.all(finishes.mock.results.map(result => result.value.catch(() => null)));
      expect(subjects[0]).toMatch(/^device\/[\w-]{32}$/); expect(subjects[2]).toBe(subjects[0]);

      const wrongKey = await begin();
      const forged = {publicKey:player.publicKey,signature:stranger.signIn(circle,wrongKey.challenge).signature};
      expect((await finish(forged,wrongKey.cookie)).json.error).toBe('sign-in-failed');
      const altered = await begin();
      const changed = altered.challenge.slice(0,-1) + (altered.challenge.endsWith('A') ? 'B' : 'A');
      expect((await finish(player.signIn(circle,changed),altered.cookie)).json.error).toBe('sign-in-failed');
      const elsewhere = await begin();
      expect((await finish(player.signIn('https://other.example',elsewhere.challenge),elsewhere.cookie)).json.error).toBe('sign-in-failed');
      const expired = await begin();
      time += 120_000;
      expect((await finish(player.signIn(circle,expired.challenge),expired.cookie)).json.error).toBe('sign-in-failed');
      const extra = await begin();
      expect((await finish({...player.signIn(circle,extra.challenge),subject:'forged'},extra.cookie)).json.error).toBe('invalid-request');

      const fallback = await begin();
      expect((await finish(older.signIn(circle,fallback.challenge),fallback.cookie)).json).toEqual({authenticated:true});
      expect(await finishes.mock.results.at(-1).value).not.toBe(subjects[0]);
    } finally { deviceKeys.close(); }
  });

  it('uses the configured external origin and issues a secure session behind a proxy', async () => {
    await start({ origin:'https://circle.example' });
    expect((await post('auth/start',{email:'a@b.example'})).status).toBe(403);
    const grant = await post('auth/verify', { email:'a@b.example', code:'112233' }, null, {Origin:'https://circle.example'});
    expect(grant.status).toBe(200); expect(grant.cookie).toMatch(/Secure/);
  });
});
