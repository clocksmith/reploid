import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDailyApp } from './http.js';
import { createEmailIdentity } from './identity.js';
import { PROFILE, RULE_VERSION, bannedFor } from './rules.js';
import { createDailyStore } from './store.js';

export const defaultPlaytestDirectory = () => join(homedir(),'.local','share','reploid','daily-playtest');
const hash = value => 'sha256:' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
const labels = ['operator','guest-1','guest-2','guest-3'];

// Grants and their private links are persisted only in an owner-readable file.
// They are never minted for a visiting browser or appended to a forwarded dare.
export async function privatePlayerLinks({store, directory, origin, names, expiresAt}) {
  const file = join(directory,'private-links.json');
  let old;
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || (stat.mode & 0o077)) throw Error('Playtest links require a private regular file.');
    old = JSON.parse(await readFile(file,'utf8'));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const existing = old?.circleToken && store.resolveCircle(old.circleToken);
  const circle = existing ? { ...existing, token:old.circleToken } : store.circleInvite({ expiresAt });
  const link = player => {
    const url = new URL('/',origin);
    const fragment = new URLSearchParams({invite:circle.token});
    if (player) fragment.set('player',player);
    url.hash = fragment.toString();
    return url.href;
  };
  const players = {};
  for (const name of names) {
    const existingPlayer = old?.players?.[name];
    if (!existingPlayer || !store.guest(existingPlayer.token)) {
      const issued = store.authorizeGuest({subject:'private-playtest-player/' + name, expiresAt:circle.expiresAt});
      players[name] = {id:issued.id, token:issued.token, url:link(issued.token)};
    } else { players[name] = {...existingPlayer, url:link(existingPlayer.token)}; }
  }
  for (const [name,player] of Object.entries(old?.players ?? {})) if (!names.includes(name)) store.revokeInvite(player.id);
  const data = {circleId:circle.id, circleToken:circle.token, expiresAt:new Date(circle.expiresAt).toISOString(),
    invitation:link(), players};
  const temporary = file + '.' + randomUUID();
  await writeFile(temporary,JSON.stringify(data,null,2) + '\n',{flag:'wx',mode:0o600});
  await rename(temporary,file);
  // Loopback TCP alone cannot identify the OS user. The private on-disk launcher
  // is the desktop owner's one-click credential, never a publicly served asset.
  const ownerUrl = players.operator?.url ?? data.invitation;
  const escaped = ownerUrl.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  const page = '<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer">' +
    '<meta http-equiv="refresh" content="0;url=' + escaped + '"><title>Open Reploid Daily</title>' +
    '<a rel="noreferrer" href="' + escaped + '">Open my private game</a>';
  const owner = join(directory,'open-owner.html');
  const stagedOwner = owner + '.' + randomUUID();
  await writeFile(stagedOwner,page,{flag:'wx',mode:0o600});
  await rename(stagedOwner,owner);
  return file;
}

export function playtestCalendar({target, backendIdentityHash, providerId}) {
  if (typeof target !== 'string' || !target.trim() || target !== target.trim() || target.length > 120
    || /\p{C}/u.test(target) || !bannedFor(target).length || !/^sha256:[a-f0-9]{64}$/.test(backendIdentityHash)) {
    throw Error('Provide a target phrase and the physical backend SHA-256 from its Doppler measurement.');
  }
  return day => {
    const descriptor = {day,target,banned:bannedFor(target), modelId:PROFILE.modelId, modelIdentity:PROFILE.modelIdentity, ruleVersion:RULE_VERSION};
    return {...descriptor,qualified:false,digest:hash({mode:'playtest',descriptor,backendIdentityHash,providerId:providerId ?? null,profile:PROFILE})};
  };
}

export async function openPlaytest({config, configDirectory, values, staticRoot}) {
  const port = Number(values.port ?? config.port ?? 4180);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Choose a loopback TCP port from 1 to 65535.');
  const directory = resolve(configDirectory,values.state ?? config.stateDirectory ?? defaultPlaytestDirectory());
  await mkdir(directory,{recursive:true,mode:0o700});
  const stat = await lstat(directory);
  if (!stat.isDirectory() || (stat.mode & 0o077)) throw Error('Choose a private, owner-only playtest state directory.');
  const origin = 'http://localhost:' + port;
  const backendIdentityHash = values.backend ?? config.backendIdentityHash;
  const target = values.target ?? config.target ?? 'Paris';
  const model = values.model ?? config.modelDirectory;
  const fleet = config.fleetConfig;
  if (Boolean(model) === Boolean(fleet) || (fleet && !/^peer:[a-f0-9]{24}$/.test(config.providerId))) {
    throw Error('Choose a pinned model directory for direct Doppler or an enrolled private fleet config and peer ID.');
  }
  const identity = config.auth ? createEmailIdentity(config.auth) : null;
  const names = identity ? [] : config.players ?? labels;
  if (!Array.isArray(names) || names.length > 128 || names.some(name => typeof name !== 'string'
    || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,48}$/.test(name) || Object.hasOwn(Object.prototype,name))
    || new Set(names).size !== names.length) throw Error('Choose up to 128 distinct, simple player names.');
  const gameForDay = playtestCalendar({target,backendIdentityHash,providerId:fleet ? config.providerId : null});
  const store = createDailyStore({path:join(directory,'playtest.sqlite'), mode:'playtest',hostId:'private-playtest',hostDailyCap:config.hostDailyCap ?? 24});
  let opening, passkeys;
  const run = async input => {
    if (!opening) {
      opening = (fleet ? import('./fleet.js').then(({openDailyFleet}) => openDailyFleet({configFile:resolve(configDirectory,fleet),
        modelId:PROFILE.modelId, modelIdentity:PROFILE.modelIdentity, providerId:config.providerId, backendIdentityHash}))
        : import('./local-doppler.js').then(({openLocalPlaytest}) => openLocalPlaytest({directory:resolve(configDirectory,model),backendIdentityHash})))
        .catch(error => {opening = undefined; throw error;});
    }
    const runtime = await opening;
    input.signal.throwIfAborted();
    return runtime.run(input);
  };
  try {
    if (!identity) {
      const {openDailyPasskeys} = await import('./passkeys.js');
      passkeys = openDailyPasskeys({file:join(directory,'passkeys.sqlite'),origin});
    }
    const app = createDailyApp({store,gameForDay,run,identity,passkeys,circleName:config.circleName ?? 'Private playtest',mode:'playtest',
      evidenceKind:fleet ? 'fleet-receipt' : 'local-doppler',origin,staticRoot,timeoutMs:120_000});
    const links = await privatePlayerLinks({store,directory,origin,names,expiresAt:Date.now()+7*86400_000});
    return {app, port, links, async close() { try { if (opening) await (await opening).close(); } finally { store.close(); } }};
  } catch (error) {passkeys?.close();store.close(); throw error;}
}
