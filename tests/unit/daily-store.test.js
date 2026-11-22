// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { createDailyStore } from '../../server/daily/store.js';

describe('daily game ledger', () => {
  const day = '2026-11-21';
  let dir, path, time, store, circle;
  const until = () => time + 86400000 * 4;
  const open = (extra = {}) => createDailyStore({ path, hostId: 'one-host', hostDailyCap: 8, now: () => time, ...extra });
  const grant = subject => store.authorizeGuest({ subject, expiresAt: until() });
  const submit = (credential, key, extra = {}) => store.reserve({
    invite: circle.token, token: credential.token, day, key, prompt: 'say something', words: 2, ...extra,
  });
  const finish = (attempt, won = true) => store.complete(attempt.id, {
    output: won ? 'Answer.' : 'Other.', won, receipt: { signature: 'test', attempt: attempt.id },
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reploid-daily-'));
    path = join(dir, 'game.sqlite');
    time = Date.parse(day + 'T12:00:00Z');
    store = open();
    circle = store.circleInvite({ expiresAt: until() });
  });
  afterEach(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });

  it('breaks ties between equal winners by signed closeness and shows closeness on a miss', () => {
    const scored = (credential, key, totalLogProbHundredths, won = true) => {
      const { attempt } = submit(credential, key, { prompt: 'say yes', words: 2 });
      store.markDispatched(attempt.id);
      return store.complete(attempt.id, { output: won ? 'Answer.' : 'Other.', won, receipt: { signature: 'test', attempt: attempt.id },
        score: totalLogProbHundredths === null ? null : { totalLogProbHundredths, tokenCount: 2 } });
    };
    const [ana, ben, cal, dee] = ['ana', 'ben', 'cal', 'dee'].map(name => grant(`verified:${name}`));
    scored(ana, 'a', -200);
    scored(ben, 'b', -20);
    scored(cal, 'c', null);
    const miss = scored(dee, 'd', -140, false);
    // Same words and characters: the closer prompt ranks first; an unscored win ranks after scored ones.
    expect(store.leaderboard(day)).toEqual([
      { rank: 1, words: 2, characters: 7, closeness: 90 }, { rank: 2, words: 2, characters: 7, closeness: 37 },
      { rank: 3, words: 2, characters: 7, closeness: null },
    ]);
    expect(miss).toMatchObject({ won: false, closeness: 50 });
    // An invalid score is not stored.
    const { attempt } = submit(dee, 'e'); store.markDispatched(attempt.id);
    expect(store.complete(attempt.id, { output: 'x', won: false, receipt: { r: 1 }, score: { totalLogProbHundredths: 5, tokenCount: 2 } }).closeness).toBeNull();
  });

  it('enforces the cap across reissued guest credentials, independent database clients, and restarts', () => {
    const alice = grant('verified:alice');
    const second = store.authorizeGuest({ subject: 'verified:alice', expiresAt: until() });
    expect(second.guestId).toBe(alice.guestId);
    const first = submit(alice, '1');
    expect(first.created).toBe(true);
    expect(submit(second, '1')).toEqual({ created: false, attempt: first.attempt });
    expect(() => submit(alice, '1', { prompt: 'different', words: 1 })).toThrow('request_key_conflict');
    const other = open();
    try {
      other.reserve({ token: second.token, invite: circle.token, day, key: '2', prompt: 'try', words: 1 });
      // The cap is TURNS_PER_DAY (5) across credentials, clients and restarts.
      submit(alice, '3'); submit(alice, '4'); submit(alice, '5');
      expect(() => other.reserve({ token: second.token, invite: circle.token, day, key: '6', prompt: 'try', words: 1 }))
        .toThrow('daily_attempt_limit');
    } finally { other.close(); }
    const done = finish(first.attempt);
    expect(finish(first.attempt)).toEqual(done);
    expect(() => finish(first.attempt, false)).toThrow('result_conflict');
    store.close(); store = open();
    expect(submit(second, '1')).toEqual({ created: false, attempt: done });
    expect(store.history(second.token, day)).toHaveLength(5);
    expect(() => open({ hostId: 'different-host' })).toThrow('store_host_mismatch');
    expect(() => open({ mode:'playtest' })).toThrow('store_mode_mismatch');
    const file = readFileSync(path);
    for (const value of [alice.token, second.token, circle.token, 'verified:alice']) expect(file.includes(value)).toBe(false);
    expect(statSync(path).mode & 0o077).toBe(0);
  });

  it('returns a definitively rejected turn, and preserves budget once a dispatch becomes uncertain', () => {
    const owner = grant('one');
    const a = submit(owner, 'a').attempt;
    expect(store.release(a.id)).toBe(true);
    expect(store.capacity(day)).toEqual({ used: 0, cap: 8 });
    const next = submit(owner, 'a').attempt;
    expect(next.id).not.toBe(a.id);
    expect(store.markDispatched(next.id)).toBe(true);
    expect(store.release(next.id)).toBe(false);
    expect(store.markUnresolved(next.id)).toBe(true);
    expect(submit(owner, 'a')).toMatchObject({ created: false, attempt: { status: 'unresolved' } });
    expect(store.activity().players).toBe(1);
    finish(next);
    const oneTurn = open({ hostDailyCap: 1 });
    try {
      expect(() => oneTurn.reserve({ token: grant('two').token, invite: circle.token, day, key: 'b', prompt: 'go', words: 1 }))
        .toThrow('host_daily_limit');
    } finally { oneTurn.close(); }
  });

  it('enforces distinct expiring, revocable circle and guest grants and keeps prompts private', () => {
    const alice = grant('alice'), bob = grant('bob');
    const a = submit(alice, 'a').attempt;
    expect(() => store.publish(alice.token, a.id)).toThrow('winning_attempt_required');
    finish(a);
    expect(store.history(bob.token, day)).toEqual([]);
    expect(() => store.publish(bob.token, a.id)).toThrow('unknown_attempt');
    expect(store.resolveCircle(alice.token)).toBeNull();
    expect(store.guest(circle.token)).toBeNull();
    const shared = store.publish(alice.token, a.id);
    expect(store.publish(alice.token, a.id)).toEqual(shared);
    expect(Object.keys(shared).sort()).toEqual(['attemptNumber','characters','day','id','output','receiptDigest','words']);
    expect(shared.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    store.revokeCircle(circle.id);
    expect(() => submit(alice, 'next')).toThrow('circle_invite_required');
    circle = store.circleInvite({ expiresAt: time + 100 });
    store.revokeInvite(alice.id);
    expect(() => submit(alice, 'next')).toThrow('guest_grant_required');
    time += 101;
    expect(() => submit(bob, 'next')).toThrow('circle_invite_required');
    circle = store.circleInvite({ expiresAt: time + 100 });
    const temporary = store.authorizeGuest({ subject: 'temporary', expiresAt: time + 1 });
    time += 2;
    expect(() => submit(temporary, 'next')).toThrow('guest_grant_required');
    expect(store.readShare(shared.id)).toEqual(shared);
  });

  it('attributes an actual distinct third participant across a chain and carries the original referral through later tries', () => {
    const alice = grant('a'), bob = grant('b'), cara = grant('c');
    const winA = finish(submit(alice, 'win').attempt);
    const shareA = store.publish(alice.token, winA.id);
    finish(submit(bob, 'try', { via: shareA.id }).attempt, false);
    const winB = finish(submit(bob, 'win').attempt);
    const shareB = store.publish(bob.token, winB.id);
    finish(submit(alice, 'again', { via: shareB.id }).attempt);
    expect(store.metrics()).toEqual({ thirdParticipants: 0 });
    store.readShare(shareB.id);
    expect(store.recordDareOpen(shareB.id)).toBe(true);
    expect(store.recordDareOpen(shareB.id)).toBe(false);
    expect(store.recordDareOpen('unknown')).toBe(false);
    expect(store.ownerStats()).toMatchObject({ publishedDares:2, openedDares:1, playedDares:2, darePlayers:2, consecutiveDayPlayers:0 });
    const trial = submit(cara, 'try', { via: shareB.id }).attempt;
    expect(store.metrics()).toEqual({ thirdParticipants: 0 });
    store.markDispatched(trial.id);
    expect(store.metrics(day)).toEqual({ thirdParticipants: 1 });
    finish(trial, false);
    finish(submit(cara, 'another', { via: shareB.id }).attempt);
    expect(store.activity()).toEqual({ players: 3, returningPlayers: 0, thirdParticipants: 1 });
    time += 86400000;
    expect(store.readShare(shareA.id)).toEqual(shareA);
    expect(() => submit(cara, 'yesterday')).toThrow('challenge_closed');
    expect(() => submit(cara, 'cross-day', { day: '2026-11-22', via: shareA.id })).toThrow('invalid_share');
    finish(submit(cara, 'today', { day: '2026-11-22' }).attempt);
    expect(store.activity()).toEqual({ players: 3, returningPlayers: 1, thirdParticipants: 1 });
    expect(store.ownerStats()).toMatchObject({consecutiveDayPlayers:1, publishedDares:2, openedDares:1, playedDares:2, darePlayers:3});
    time += 2 * 86400000;
    finish(submit(alice, 'skip-day', { day: '2026-11-24' }).attempt);
    expect(store.ownerStats()).toMatchObject({returningPlayers:2, consecutiveDayPlayers:1});
  });

  it('fixes reveal availability on the first accepted turn and closes the full next-day return window', () => {
    const author = grant('author'), early = grant('early'), late = grant('late'), absent = grant('absent');
    const winning = finish(submit(author,'winner').attempt);
    store.publish(author.token, winning.id, {allowReveal:true});
    const play = (who, key) => submit(who, key, {day:new Date(time).toISOString().slice(0,10)}).attempt;
    const zero = {eligibleGuestDays:0, nextDayReturns:0};
    time += 86400000;
    const earlyAttempt = play(early, 'first'); store.markDispatched(earlyAttempt.id);
    const rejected = play(late, 'not-accepted'); store.release(rejected.id);
    store.reviewReveal(winning.id);
    // Early now sees the reveal on their second turn. Their first play remains unexposed.
    finish(earlyAttempt, false); finish(play(early, 'second'), false);
    store.markUnresolved(play(late, 'accepted').id); finish(play(absent, 'accepted'));
    store.setRevealConsent(author.token, winning.id, false);
    expect(store.ownerStats().nextDayReturn.total).toEqual(zero);
    time += 86400000;
    finish(play(early, 'returned'), false); finish(play(late, 'returned'), false);
    const declined = play(absent, 'declined'); store.release(declined.id);
    // Day one's follow-up has closed. Day two still has time to accrue returns.
    expect(store.ownerStats().nextDayReturn).toEqual({withReveal:zero, withoutReveal:{eligibleGuestDays:1,nextDayReturns:0},
      unknown:zero, total:{eligibleGuestDays:1,nextDayReturns:0}});
    time = Date.parse('2026-11-24T00:00:00Z');
    const stats = store.ownerStats();
    expect(stats.nextDayReturn).toEqual({withReveal:{eligibleGuestDays:2,nextDayReturns:1},
      withoutReveal:{eligibleGuestDays:2,nextDayReturns:1}, unknown:zero, total:{eligibleGuestDays:4,nextDayReturns:2}});
    expect(JSON.stringify(stats)).not.toContain(winning.prompt); expect(JSON.stringify(stats)).not.toContain(winning.output);
    expect(store.activity()).not.toHaveProperty('nextDayReturn');
  });

  it('retains unknown exposure for legacy guest-days when a player returns after upgrade', () => {
    const player = grant('existing-player'); finish(submit(player,'before-upgrade').attempt);
    store.close();
    const old = new DatabaseSync(path); old.exec('DROP TABLE daily_reveal_cohorts'); old.close();
    store = open(); finish(submit(player,'second-play').attempt);
    time += 86400000; finish(submit(player,'returned', {day:'2026-11-22'}).attempt);
    time += 86400000;
    expect(store.ownerStats().nextDayReturn.unknown).toEqual({eligibleGuestDays:1,nextDayReturns:1});
    expect(store.ownerStats().nextDayReturn.withoutReveal).toEqual({eligibleGuestDays:0,nextDayReturns:0});
  });

  it('excludes evidenced scripted accounts from standings, reveals and acquisition while retaining every paid try and replay', () => {
    const author=grant('human-a'), script=grant('identified-test'), visitor=grant('human-c');
    const a=finish(submit(author,'a',{prompt:'please speak kindly',words:3}).attempt);
    const sharedA=store.publish(author.token,a.id,{allowReveal:true});
    const b=finish(submit(script,'b',{prompt:'X',words:1,via:sharedA.id}).attempt);
    const sharedB=store.publish(script.token,b.id,{allowReveal:true});
    const c=finish(submit(visitor,'c',{prompt:'try this',words:2,via:sharedB.id}).attempt);
    const sharedC=store.publish(visitor.token,c.id,{allowReveal:true});
    for (const [entry,share] of [[a,sharedA],[b,sharedB],[c,sharedC]]) {
      store.reviewReveal(entry.id); store.recordDareOpen(share.id);
    }
    expect(store.ownerStats()).toMatchObject({players:3,thirdParticipants:1,playedDares:2});
    expect(() => store.classifyScripted({attemptId:b.id,receiptDigest:a.receiptDigest,excluded:true})).toThrow('qa_evidence_does_not_match');
    const classify = excluded => store.classifyScripted({attemptId:b.id,receiptDigest:b.receiptDigest,excluded});
    expect(classify(true).changed).toBe(true); expect(classify(true).changed).toBe(false);
    expect(store.leaderboard(day)).toEqual([{rank:1,words:2,characters:8,closeness:null},{rank:2,words:3,characters:19,closeness:null}]);
    expect(store.ownerStats()).toMatchObject({players:2,scriptedQA:{accounts:1,acceptedTurns:1},openedDares:2,
      publishedDares:2,playedDares:0,darePlayers:0,thirdParticipants:0});
    expect(store.capacity(day).used).toBe(3);
    expect(store.history(script.token,day)[0]).toMatchObject({id:b.id,receipt:b.receipt,receiptDigest:b.receiptDigest,attemptNumber:1});
    expect(store.readShare(sharedB.id)).toEqual(sharedB);
    time+=86400000;
    expect(store.yesterdayWinners().map(x=>x.prompt)).toEqual(['try this']);
    expect(store.reviewQueue().map(x=>x.attemptId)).toEqual([c.id]);
    finish(submit(script,'next',{day:'2026-11-22'}).attempt,false); finish(submit(author,'next',{day:'2026-11-22'}).attempt,false);
    time+=86400000;
    expect(store.ownerStats()).toMatchObject({players:2,returningPlayers:1,consecutiveDayPlayers:1,scriptedQA:{accounts:1,acceptedTurns:2},
      nextDayReturn:{total:{eligibleGuestDays:2,nextDayReturns:1}}});
    expect(classify(false).changed).toBe(true); expect(classify(false).changed).toBe(false);
    expect(store.leaderboard(day)[0]).toEqual({rank:1,words:1,characters:1,closeness:null});
    expect(store.ownerStats()).toMatchObject({players:3,returningPlayers:2,consecutiveDayPlayers:2,thirdParticipants:1,playedDares:2,
      nextDayReturn:{total:{eligibleGuestDays:3,nextDayReturns:2}}});
  });

  it('ranks each guest once using Unicode character length, and reveals only reviewed, consenting yesterday winners', () => {
    const alice = grant('alice'), bob = grant('bob'), cara = grant('cara');
    const win = (g, key, prompt, words) => finish(submit(g, key, { prompt, words }).attempt);
    const a = win(alice, 'first', 'longer', 1);
    const a2 = win(alice, 'second', '𐐀', 1);
    const b = win(bob, 'one', 'X', 1);
    const c = win(cara, 'one', 'a b', 2);
    expect(store.leaderboard(day)).toEqual([
      {rank: 1, words: 1, characters: 1, closeness: null}, {rank: 1, words: 1, characters: 1, closeness: null}, {rank: 3, words: 2, characters: 3, closeness: null},
    ]);
    store.publish(alice.token, a.id, {allowReveal: true}); store.reviewReveal(a.id);
    store.publish(alice.token, a2.id, {allowReveal: true});
    store.publish(bob.token, b.id); expect(store.reviewReveal(b.id)).toBe(false);
    store.publish(cara.token, c.id, {allowReveal: true}); store.reviewReveal(c.id);
    expect(store.yesterdayWinners()).toEqual([]);
    time += 86400000;
    expect(store.yesterdayWinners()).toEqual([]);
    expect(store.reviewQueue().map(row => row.attemptId)).toEqual([a2.id]);
    store.reviewReveal(a2.id);
    expect(store.yesterdayWinners()).toEqual([{prompt:'𐐀',words:1,characters:1}]);
    store.setRevealConsent(alice.token, a2.id, false);
    expect(store.yesterdayWinners()).toEqual([]);
  });
});
