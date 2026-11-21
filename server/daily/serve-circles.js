import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createDailyCalendar } from './challenges.js';
import { createDailyApp } from './http.js';
import { createEmailIdentity } from './identity.js';
import { PROFILE, dayUTC } from './rules.js';
import { createDailyStore } from './store.js';

const readJson = async path => JSON.parse(await readFile(path,'utf8'));

// Both HTTP servers use one native signing identity and one hardware admission
// slot. The slot belongs to the underlying operation until its outcome settles.
export function sharedDailyRunner(open, overBudget = () => false) {
  let opened, active, closing = false;
  return {
    run(input) {
      if (closing || active) throw Object.assign(Error('The shared provider is in use.'),{code:'DAILY_HOST_BUSY'});
      if (overBudget(input.day ?? dayUTC())) throw Object.assign(Error('Daily physical host budget is full.'),{code:'DAILY_SHARED_LIMIT'});
      active = Promise.resolve().then(async () => {
        input.signal.throwIfAborted();
        opened ??= Promise.resolve().then(open).catch(error => {opened = undefined; throw error;});
        const fleet = await opened;
        input.signal.throwIfAborted();
        return fleet.run(input);
      }).finally(() => { active = undefined; });
      return active;
    },
    async close() {
      closing = true;
      await active?.catch(() => {});
      if (opened) await (await opened).close();
    },
  };
}

async function openRankedCircle({config, directory, database, port}, runner, staticRoot, sharedFull) {
  const file = path => resolve(directory,path);
  const usePasskeys = config.auth?.type === 'passkey';
  const names = config.bootstrapPlayers ?? [];
  if (!Array.isArray(names) || names.some(name => typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,48}$/i.test(name)
    || Object.hasOwn(Object.prototype,name)) || new Set(names).size !== names.length) throw Error('Invalid private player names.');
  if (config.publicChallenge === true && (!usePasskeys || names.length || new URL(config.origin).protocol !== 'https:' || config.hostDailyCap < 1)) {
    throw Error('A public challenge requires HTTPS, passkeys, a positive daily cap and no host bootstrap seats.');
  }
  const store = createDailyStore({path:database,hostId:config.providerId,hostDailyCap:config.hostDailyCap});
  let passkeys, admitStart;
  const trustedFrontends = new Map();
  const close = () => {
    for (const frontend of trustedFrontends.values()) frontend.passkeys.close();
    passkeys?.close(); store.close();
  };
  try {
    const calendar = createDailyCalendar({schedule:config.signedCalendar ? await readJson(file(config.signedCalendar)) : undefined,
      qualifications:await Promise.all((config.qualifications ?? []).map(path => readJson(file(path)))),
      calendarPublicKey:config.calendarPublicKey ? await readFile(file(config.calendarPublicKey)) : undefined,
      providerId:config.providerId, backendIdentityHash:config.backendIdentityHash, previewTarget:config.previewTarget});
    if (usePasskeys) {
      const {openDailyPasskeys, publicPasskeyStartBudget} = await import('./passkeys.js');
      admitStart = config.publicChallenge === true ? publicPasskeyStartBudget() : undefined;
      passkeys = openDailyPasskeys({file:database+'.passkeys',origin:config.origin,admitStart});
    }
    const frontends = config.trustedFrontendOrigins ?? [];
    if (!Array.isArray(frontends) || (frontends.length && (config.publicChallenge !== true || !usePasskeys))) {
      throw Error('Alternate public frontends require a public, passkey-protected circle.');
    }
    for (const origin of frontends) {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || origin !== url.origin || origin === config.origin || trustedFrontends.has(origin)) {
        throw Error('Use distinct, exact HTTPS frontend origins.');
      }
      const {openDailyPasskeys} = await import('./passkeys.js');
      const rp = createHash('sha256').update(origin).digest('hex');
      const identity = openDailyPasskeys({file:database+'.passkeys.'+rp,origin,admitStart});
      trustedFrontends.set(origin,{passkeys:identity});
    }
    const accessDirectory = config.accessDirectory ? file(config.accessDirectory) : dirname(database);
    if (names.length) {
      const {privatePlayerLinks} = await import('./playtest.js');
      await privatePlayerLinks({store,directory:accessDirectory,origin:config.origin,names,expiresAt:Date.now()+7*86400_000});
    }
    let publicInvite = null;
    if (config.publicChallenge === true) {
      const {ensurePublicDailyInvite} = await import('./public-invite.js');
      publicInvite = await ensurePublicDailyInvite({store,directory:accessDirectory,origin:config.origin});
    }
    const app = createDailyApp({store,gameForDay:calendar.gameForDay,run:runner.run,staticRoot,origin:config.origin,
      sharedFull,trustedFrontends,circleName:config.circleName,recipientName:config.recipientName,relayName:config.relayName,passkeys,hostGrants:names.length > 0,publicInvite,
      identity:usePasskeys ? null : createEmailIdentity(config.auth)});
    return {app,port,capacity:store.capacity,close};
  } catch (error) { close(); throw error; }
}

// Prepare every calendar, credential store and origin before accepting traffic.
export async function openRankedCircles({files, port:primaryPort, staticRoot}) {
  const entries = await Promise.all(files.map(async (path,index) => {
    const directory = dirname(resolve(path)), config = await readJson(path);
    const port = Number((index === 0 ? primaryPort : undefined) ?? config.port ?? 4180);
    if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw Error('Port must be between 0 and 65535.');
    if (typeof config.origin !== 'string' || !config.circleName || !config.fleetConfig || !config.providerId
      || !config.backendIdentityHash || !Number.isSafeInteger(config.hostDailyCap) || config.hostDailyCap < 0) {
      throw Error('Complete the circle, host budget and provider configuration.');
    }
    const database = resolve(directory,config.database);
    const pins = {configFile:await realpath(resolve(directory,config.fleetConfig)),modelId:PROFILE.modelId,modelIdentity:PROFILE.modelIdentity,
      providerId:config.providerId,backendIdentityHash:config.backendIdentityHash};
    return {config,directory,database,port,pins};
  }));
  if (!entries.length || entries.some(entry => JSON.stringify(entry.pins) !== JSON.stringify(entries[0].pins))) {
    throw Error('All listeners must select the same requester configuration and provider pins.');
  }
  for (const values of [entries.map(e=>e.database), entries.map(e=>new URL(e.config.origin).origin), entries.filter(e=>e.port!==0).map(e=>e.port)]) {
    if (new Set(values).size !== values.length) throw Error('Choose distinct score databases, origins and ports for the circles.');
  }
  const cap = entries[0].config.sharedHostDailyCap ?? entries.reduce((sum,e) => sum+e.config.hostDailyCap,0);
  if (!Number.isSafeInteger(cap) || cap < 0 || entries.some(e => (e.config.sharedHostDailyCap ?? cap) !== cap)) {
    throw Error('Configure one nonnegative physical budget across the listeners.');
  }
  const circles = [];
  const used = day => circles.reduce((sum,c) => sum+c.capacity(day).used,0);
  // The new attempt already holds a local reservation when run() enters, so
  // admission permits equality; before an attempt is reserved the board is full at equality.
  const runner = sharedDailyRunner(async () => (await import('./fleet.js')).openDailyFleet(entries[0].pins), day => used(day) > cap);
  try {
    for (const entry of entries) circles.push(await openRankedCircle(entry,runner,staticRoot,day => used(day) >= cap));
    const inodes = await Promise.all(entries.map(async e => {const f = await stat(e.database); return f.dev + ':' + f.ino;}));
    if (new Set(inodes).size !== inodes.length) throw Error('Each circle needs its own score ledger.');
    return {circles, async close() { try { await runner.close(); } finally { for (const c of circles) c.close(); } }};
  } catch (error) { for (const c of circles) c.close(); throw error; }
}

export async function serveRankedCircles(options) {
  const service = await openRankedCircles(options), servers = [];
  const stop = () => { for (const server of servers) if (server.listening) server.close(); };
  try {
    for (const circle of service.circles) {
      const server = circle.app.listen(circle.port,'127.0.0.1'); servers.push(server);
      await once(server,'listening');
      console.log('Reploid Daily listening on http://127.0.0.1:' + server.address().port);
    }
    process.once('SIGTERM',stop); process.once('SIGINT',stop);
    await Promise.all(servers.map(s => once(s,'close')));
  } finally {
    process.removeListener('SIGTERM',stop); process.removeListener('SIGINT',stop);
    await Promise.all(servers.filter(s => s.listening).map(s => new Promise(done => s.close(done))));
    await service.close();
  }
}
