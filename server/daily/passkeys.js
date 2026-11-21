import {randomBytes} from 'node:crypto';
import {constants, openSync, fstatSync, closeSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse} from '@simplewebauthn/server';

// A single public-circle budget can be shared across RP-specific passkey stores.
// Only a clock, a count, and a deadline are retained. No IP or visitor identifier is used.
export function publicPasskeyStartBudget(clock = Date.now) {
  let count = 0, nextWindow = 0;
  return () => {
    const time = clock();
    if (time >= nextWindow) {count = 0; nextWindow = time + 60_000;}
    if (count >= 12) throw Object.assign(Error('Public passkey ceremony budget is full.'),{code:'passkey_rate_limit'});
    count++;
  };
}

// The credential is the persistent player identity. Clearing cookies requires a new assertion.
export function openDailyPasskeys({file,origin,clock=Date.now,startsPerMinute=60,admitStart}) {
  const url = new URL(origin);
  if (url.origin !== origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost'))) {
    throw Error('Use a dedicated HTTPS origin or http://localhost for passkeys.');
  }
  if (file !== ':memory:') {
    const fd = openSync(file,constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,0o600);
    try {
      const info = fstatSync(fd);
      if (!info.isFile() || info.mode & 0o077 || (process.getuid && info.uid !== process.getuid())) throw Error('Use an owner-only passkey database.');
    } finally {closeSync(fd);}
  }
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, handle TEXT UNIQUE NOT NULL, publicKey BLOB NOT NULL, counter INTEGER NOT NULL)');
  const pending = new Map();
  const windows = new Map();
  const timeout = 120_000;
  if (!Number.isSafeInteger(startsPerMinute) || startsPerMinute < 1 || startsPerMinute > 60) throw Error('Invalid passkey ceremony budget.');
  const rpID = url.hostname;
  async function start(action,inviteId) {
    if (!['register','login'].includes(action)) throw Error('Unknown passkey action.');
    admitStart?.();
    const now = clock();
    for (const [id,row] of pending) if (row.expires <= now) pending.delete(id);
    for (const [id,row] of windows) if (row.expires <= now) windows.delete(id);
    const rate = windows.get(inviteId) ?? {count:0,expires:now + 60_000};
    if (pending.size >= 96 || rate.count >= startsPerMinute) throw Object.assign(Error('Too many pending passkey requests.'),{code:'passkey_rate_limit'});
    rate.count++; windows.set(inviteId,rate);
    const grant = randomBytes(32).toString('base64url');
    const handle = randomBytes(24);
    const options = action === 'register' ? await generateRegistrationOptions({
      rpID,rpName:'Reploid Daily',userName:'Player ' + handle.toString('hex').slice(0,8),userID:handle,
      timeout,attestationType:'none',supportedAlgorithmIDs:[-7,-257],
      authenticatorSelection:{residentKey:'required',userVerification:'required'},
      excludeCredentials:db.prepare('SELECT id FROM credentials').all(),
    }) : await generateAuthenticationOptions({rpID,userVerification:'required',timeout});
    pending.set(grant,{action,handle:handle.toString('base64url'),inviteId,challenge:options.challenge,expires:now+timeout});
    return {grant,options};
  }
  async function finish(token,inviteId,response) {
    const row = pending.get(token);
    pending.delete(token);
    if (!row || row.expires <= clock() || row.inviteId !== inviteId) throw Error('Expired passkey ceremony.');
    if (!response || typeof response.id !== 'string' || response.type !== 'public-key') throw Error('Missing passkey.');
    const checks = {response,expectedOrigin:origin,expectedRPID:rpID,expectedChallenge:row.challenge,requireUserVerification:true};
    if (row.action === 'register') {
      const result = await verifyRegistrationResponse({...checks,supportedAlgorithmIDs:[-7,-257]});
      if (!result.verified || !result.registrationInfo) throw Error('Passkey registration failed.');
      const {credential} = result.registrationInfo;
      db.prepare('INSERT INTO credentials VALUES (?,?,?,?)').run(credential.id,row.handle,credential.publicKey,credential.counter);
      return 'passkey/' + row.handle;
    }
    const saved = db.prepare('SELECT * FROM credentials WHERE id=?').get(response.id);
    if (!saved || saved.handle !== response.response?.userHandle) throw Error('Unknown passkey.');
    const result = await verifyAuthenticationResponse({...checks,credential:{id:saved.id,publicKey:saved.publicKey,counter:saved.counter}});
    if (!result.verified || !db.prepare('UPDATE credentials SET counter=? WHERE id=? AND counter=?')
      .run(result.authenticationInfo.newCounter,saved.id,saved.counter).changes) throw Error('Passkey verification failed.');
    return 'passkey/' + saved.handle;
  }
  return {start,finish,close(){ pending.clear();windows.clear();db.close(); }};
}
