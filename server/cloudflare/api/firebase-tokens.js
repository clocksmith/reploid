/**
 * @fileoverview Firebase Auth and App Check token verification with public keys only, for Workers.
 * Both check what the Firebase Admin SDK checks (signature, algorithm, issuer, audience, expiry,
 * subject); no Google credential is held on Cloudflare.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { verifyFirebase } from '../turn.js';

const appCheckKeys = createRemoteJWKSet(new URL('https://firebaseappcheck.googleapis.com/v1/jwks'));

/** Resolves to the decoded token with `uid`, the shape `auth.verifyIdToken()` returns. */
export function createFirebaseIdTokenVerifier(projectId, { verify = verifyFirebase } = {}) {
  if (!projectId) throw new Error('Firebase project id is required');
  return async (token) => {
    const uid = await verify(token, projectId);
    return { uid, sub: uid };
  };
}

/** App Check tokens: issuer https://firebaseappcheck.googleapis.com/<number>, audience projects/<number>. */
export async function verifyAppCheckToken(token, { projectNumber, projectId, keys = appCheckKeys } = {}) {
  if (!/^\d+$/.test(String(projectNumber || ''))) throw new Error('Firebase project number is required');
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ['RS256'], issuer: `https://firebaseappcheck.googleapis.com/${projectNumber}`,
    audience: [`projects/${projectNumber}`, ...(projectId ? [`projects/${projectId}`] : [])],
    requiredClaims: ['exp', 'sub']
  });
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('App Check token has no app id');
  return { appId: payload.sub };
}
