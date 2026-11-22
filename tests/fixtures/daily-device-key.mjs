// A Reploid Daily device key held by the test process. It signs the same bytes
// the browser signs with WebCrypto, using only node:crypto.
import {generateKeyPairSync, sign} from 'node:crypto';
import {deviceKeyMessage} from '../../server/daily/device-keys.js';

export function createTestDeviceKey(type = 'ed25519') {
  const {publicKey, privateKey} = type === 'p256'
    ? generateKeyPairSync('ec',{namedCurve:'prime256v1'})
    : generateKeyPairSync('ed25519');
  const signBytes = bytes => (type === 'p256'
    ? sign('sha256',bytes,{key:privateKey,dsaEncoding:'ieee-p1363'})
    : sign(null,bytes,privateKey)).toString('base64url');
  return {
    publicKey: publicKey.export({type:'spki',format:'der'}).toString('base64url'),
    // Returns the finish payload for a challenge issued to this origin.
    signIn(origin, challenge) {
      return {publicKey:this.publicKey, signature:signBytes(deviceKeyMessage(origin,challenge))};
    },
  };
}
