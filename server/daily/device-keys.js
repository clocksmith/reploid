import {createPublicKey, randomBytes, verify} from 'node:crypto';
import {constants, openSync, fstatSync, closeSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

// The browser signs exactly these bytes. The origin and the one-time challenge keep
// a signature made for one circle origin or one ceremony from being accepted elsewhere.
export const DEVICE_KEY_CONTEXT = 'reploid-daily-device-key/v1';
export function deviceKeyMessage(origin, challenge) {
  return Buffer.from(DEVICE_KEY_CONTEXT + '\n' + origin + '\n' + challenge, 'utf8');
}

// A single public-circle budget can be shared across origin-specific device key stores.
// Only a clock, a count, and a deadline are retained. No IP or visitor identifier is used.
export function publicSignInStartBudget(clock = Date.now) {
  let count = 0, nextWindow = 0;
  return () => {
    const time = clock();
    if (time >= nextWindow) {count = 0; nextWindow = time + 60_000;}
    if (count >= 12) throw Object.assign(Error('Public sign-in budget is full.'),{code:'sign_in_rate_limit'});
    count++;
  };
}

// Accepts an SPKI public key for Ed25519 or ECDSA P-256 and keeps its canonical encoding.
function importDeviceKey(encoded) {
  if (typeof encoded !== 'string' || !/^[\w-]{40,200}$/.test(encoded)) throw Error('Missing device public key.');
  const key = createPublicKey({key:Buffer.from(encoded,'base64url'),format:'der',type:'spki'});
  let algorithm;
  if (key.asymmetricKeyType === 'ed25519') algorithm = 'ed25519';
  else if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1') algorithm = 'p256';
  else throw Error('Unsupported device key algorithm.');
  return {key,algorithm,spki:key.export({type:'spki',format:'der'})};
}

function signatureValid({key,algorithm}, message, encoded) {
  if (typeof encoded !== 'string' || !/^[\w-]{86}$/.test(encoded)) return false;
  const signature = Buffer.from(encoded,'base64url');
  if (signature.length !== 64) return false;
  // WebCrypto ECDSA signatures use the raw r || s form, not DER.
  return algorithm === 'ed25519' ? verify(null,message,key,signature)
    : verify('sha256',message,{key,dsaEncoding:'ieee-p1363'},signature);
}

// The device public key is the persistent player identity for this origin. Its private key
// stays in one browser profile; clearing that site's data starts a new player.
export function openDailyDeviceKeys({file,origin,clock=Date.now,startsPerMinute=60,admitStart}) {
  const url = new URL(origin);
  if (url.origin !== origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost'))) {
    throw Error('Use a dedicated HTTPS origin or http://localhost for device keys.');
  }
  if (file !== ':memory:') {
    const fd = openSync(file,constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,0o600);
    try {
      const info = fstatSync(fd);
      if (!info.isFile() || info.mode & 0o077 || (process.getuid && info.uid !== process.getuid())) throw Error('Use an owner-only device key database.');
    } finally {closeSync(fd);}
  }
  if (!Number.isSafeInteger(startsPerMinute) || startsPerMinute < 1 || startsPerMinute > 60) throw Error('Invalid sign-in budget.');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE IF NOT EXISTS devices (handle TEXT PRIMARY KEY, publicKey BLOB UNIQUE NOT NULL, algorithm TEXT NOT NULL)');
  const pending = new Map();
  const windows = new Map();
  const timeout = 120_000;
  async function start(inviteId) {
    admitStart?.();
    const now = clock();
    for (const [id,row] of pending) if (row.expires <= now) pending.delete(id);
    for (const [id,row] of windows) if (row.expires <= now) windows.delete(id);
    const rate = windows.get(inviteId) ?? {count:0,expires:now + 60_000};
    if (pending.size >= 96 || rate.count >= startsPerMinute) throw Object.assign(Error('Too many pending sign-in requests.'),{code:'sign_in_rate_limit'});
    rate.count++; windows.set(inviteId,rate);
    const grant = randomBytes(32).toString('base64url');
    const challenge = randomBytes(32).toString('base64url');
    pending.set(grant,{inviteId,challenge,expires:now + timeout});
    return {grant,challenge};
  }
  async function finish(token,inviteId,{publicKey,signature} = {}) {
    const row = pending.get(token);
    pending.delete(token);
    if (!row || row.expires <= clock() || row.inviteId !== inviteId) throw Error('Expired sign-in challenge.');
    const device = importDeviceKey(publicKey);
    if (!signatureValid(device,deviceKeyMessage(origin,row.challenge),signature)) throw Error('Device key signature failed.');
    db.prepare('INSERT OR IGNORE INTO devices VALUES (?,?,?)').run(randomBytes(24).toString('base64url'),device.spki,device.algorithm);
    return 'device/' + db.prepare('SELECT handle FROM devices WHERE publicKey=?').get(device.spki).handle;
  }
  return {start,finish,close(){ pending.clear();windows.clear();db.close(); }};
}
