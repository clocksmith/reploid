// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { createDailyApp } from '../../server/daily/http.js';
import { createDailyStore } from '../../server/daily/store.js';
import { sharedDailyRunner } from '../../server/daily/serve-circles.js';

it('serializes dispatch from independent circle ledgers and refunds pre-admission contention', async () => {
  const day = '2026-11-21', time = Date.parse(day + 'T12:00:00Z');
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const fleet = {close:vi.fn(),run:vi.fn(async ({onDispatch}) => {
    onDispatch(); entered.resolve(); await release.promise; return {output:'Paris',receipt:{fake:'test-only'}};
  })};
  const open = vi.fn(async () => fleet);
  const circles = []; let cap = 2;
  const used = day => circles.reduce((n,c) => n+c.store.capacity(day).used,0);
  const runner = sharedDailyRunner(open, day => used(day) > cap);
  try {
    for (const name of ['first','second']) {
      const store = createDailyStore({path:':memory:',hostId:name,hostDailyCap:1,now:() => time});
      const invite = store.circleInvite({expiresAt:time+10000}); const guest = store.authorizeGuest({subject:'operator-assigned',expiresAt:time+10000});
      const app = createDailyApp({store,gameForDay:() => ({day,target:'Paris',banned:['paris'],qualified:true,digest:'pinned'}),
        run:runner.run,sharedFull:day=>used(day)>=cap,circleName:name,clock:()=>time});
      const server = app.listen(0,'127.0.0.1'); await once(server,'listening'); const base = 'http://127.0.0.1:' + server.address().port;
      const submit = async () => {const res = await fetch(base+'/api/attempt',{method:'POST', headers:{'content-type':'application/json',Origin:base,
        'x-circle-invite':invite.token,cookie:'reploid_daily_guest='+guest.token},body:JSON.stringify({day,digest:'pinned',key:'one',prompt:'name a city'})}); return res.json();};
      circles.push({store,server,submit});
    }
    const first = circles[0].submit(); await entered.promise;
    expect((await circles[1].submit()).error).toBe('busy'); expect(circles[1].store.capacity(day).used).toBe(0);
    release.resolve(); expect((await first).attempt.won).toBe(true);
    cap = 1; expect((await circles[1].submit()).error).toBe('host-full'); expect(circles[1].store.capacity(day).used).toBe(0);
    cap = 2; expect((await circles[1].submit()).attempt.won).toBe(true);
    expect(circles.map(c=>c.store.capacity(day).used)).toEqual([1,1]); expect(open).toHaveBeenCalledTimes(1); expect(fleet.run).toHaveBeenCalledTimes(2);
  } finally {
    release.resolve();
    for (const {server,store} of circles) {await new Promise(resolve => server.close(resolve)); store.close();}
    await runner.close();
  }
  expect(fleet.close).toHaveBeenCalledTimes(1);
});

it('shares twelve public device sign-in starts per minute across independent origins', async () => {
  const {openDailyDeviceKeys,publicSignInStartBudget} = await import('../../server/daily/device-keys.js');
  const {createTestDeviceKey} = await import('../fixtures/daily-device-key.mjs');
  let time = 100_000;
  const clock = () => time, admitStart = publicSignInStartBudget(clock);
  const origins = ['https://first.example','https://second.example'];
  const stores = origins.map(origin => openDailyDeviceKeys({file:':memory:',origin,clock,admitStart}));
  try {
    for (let i=0;i<12;i++) await stores[i%2].start('same-invitation');
    await expect(stores[0].start('another-invitation')).rejects.toMatchObject({code:'sign_in_rate_limit'});
    time += 60000;
    const {grant,challenge} = await stores[1].start('another-invitation');
    // A signature for the second origin does not sign in at the first one.
    const crossed = await stores[0].start('another-invitation');
    const key = createTestDeviceKey();
    await expect(stores[0].finish(crossed.grant,'another-invitation',key.signIn(origins[1],crossed.challenge))).rejects.toThrow();
    expect(await stores[1].finish(grant,'another-invitation',key.signIn(origins[1],challenge))).toMatch(/^device\//);
  } finally { for (const store of stores) store.close(); }
});
