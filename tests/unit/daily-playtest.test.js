// @vitest-environment node
import { describe, test, expect } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDailyStore } from '../../server/daily/store.js';
import { playtestCalendar, privatePlayerLinks } from '../../server/daily/playtest.js';

const backend = 'sha256:' + 'f'.repeat(64);
describe('private playtest provisioning', () => {
  test('keeps practice unqualified and pins day, provider, model and physical backend', () => {
    const config = {target:'Paris',backendIdentityHash:backend};
    const game = playtestCalendar(config)('2026-11-21');
    expect(game).toMatchObject({qualified:false,target:'Paris',banned:['paris']});
    expect(playtestCalendar(config)('2026-11-22').digest).not.toEqual(game.digest);
    expect(playtestCalendar({...config,providerId:'another-peer'})('2026-11-21').digest).not.toEqual(game.digest);
    expect(() => playtestCalendar({...config,backendIdentityHash:'unknown'})).toThrow();
  });
  test('issues separate stable owner and guest credentials in private files, and revokes removed seats', async () => {
    const directory = await mkdtemp(join(tmpdir(),'daily-private-access-'));
    const store = createDailyStore({path:join(directory,'playtest.sqlite'),hostId:'circle',mode:'playtest'});
    try {
      const settings = {store,directory,origin:'http://localhost:4180',names:['operator','guest-1'],expiresAt:Date.now()+86400000};
      const file = await privatePlayerLinks(settings);
      expect((await stat(file)).mode & 0o077).toBe(0);
      const first = JSON.parse(await readFile(file,'utf8'));
      const readLink = value => new URLSearchParams(new URL(value).hash.slice(1));
      const owner = readLink(first.players.operator.url), guest = readLink(first.players['guest-1'].url);
      expect(owner.get('invite')).toEqual(guest.get('invite')); expect(owner.get('player')).not.toEqual(guest.get('player'));
      expect(readLink(first.invitation).has('player')).toBe(false);
      const launcher = join(directory,'open-owner.html');
      expect((await stat(launcher)).mode & 0o077).toBe(0);
      const html = await readFile(launcher,'utf8'); expect(html).toContain(owner.get('player')); expect(html).not.toContain(guest.get('player'));
      await privatePlayerLinks({...settings,names:['operator','guest-2']});
      const fresh = JSON.parse(await readFile(file,'utf8'));
      expect(fresh.players.operator).toEqual(first.players.operator); expect(store.guest(guest.get('player'))).toBeNull();
      expect(store.guest(fresh.players['guest-2'].token).id).not.toEqual(store.guest(owner.get('player')).id);
    } finally {store.close(); await rm(directory,{recursive:true,force:true});}
  });
});
