import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth } from 'firebase-admin/auth';
import { createZeroGeminiHandler } from './zero-gemini-handler.js';

export { zeroGeminiPolicy } from './zero-gemini-policy.js';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

const getFirebaseAdminApp = () => {
  if (getApps().length === 0) initializeApp();
  return getApps()[0];
};

const verifyZeroAccess = async (req, { bearerToken: idToken, appCheckToken }) => {
  if (!idToken || !appCheckToken) throw new Error('Firebase Auth and App Check credentials are required.');
  const app = getFirebaseAdminApp();
  const [identity] = await Promise.all([
    getAuth(app).verifyIdToken(idToken),
    getAppCheck(app).verifyToken(appCheckToken)
  ]);
  if (!identity?.uid) throw new Error('Firebase Auth identity is missing a uid.');
  return Object.freeze({ uid: identity.uid });
};

export const zeroGemini = onRequest({
  region: 'us-central1',
  cors: false,
  secrets: [geminiApiKey],
  maxInstances: 1,
  concurrency: 20,
  memory: '256MiB',
  timeoutSeconds: 60
}, createZeroGeminiHandler({ verifyZeroAccess, getApiKey: () => geminiApiKey.value() }));
