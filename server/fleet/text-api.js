import http from 'node:http';
import https from 'node:https';
import { createTextApi } from '../text-api.js';
import { tokensEqual } from '../token-auth.js';
import { assert } from './contract.js';

function previewRecipients(preview) {
  return [...new Set([...(preview?.recipients || []), ...(preview?.input?.recipients || []),
    ...(preview?.route?.stages?.map(stage => stage.participantId) || []),
    ...[preview?.participantA, preview?.participantB, preview?.recipientIdentity || preview?.providerId].filter(Boolean)])];
}

/** Authenticated HTTP text API (/v1/models, /v1/chat/completions, /v1/responses)
 * over an enrolled native fleet requester. Non-loopback binding requires TLS;
 * every execution reserves and settles non-cash fleet service credits and checks
 * disclosed provider keys against the coordinator's enrolled computers. */
export async function startFleetTextApi({ host, token, listenHost = '127.0.0.1', port = 0, tls = null, allowedRecipients = null }) {
  assert(typeof token === 'string' && token.length >= 32, 'Strong API bearer secret required');
  assert(host?.textParticipant && typeof host.runAccountedGeneration === 'function'
    && typeof host.enrolledRecipients === 'function' && host.identity?.peerId,
  'Configured fleet host with service-credit accounting required');
  const loopback = ['127.0.0.1', '::1'].includes(listenHost);
  assert(loopback || Boolean(tls?.key && tls?.cert), 'Non-loopback fleet text API requires TLS');
  let pinned = null;
  if (allowedRecipients !== null && allowedRecipients !== undefined) {
    assert(Array.isArray(allowedRecipients) && allowedRecipients.length > 0 && allowedRecipients.length <= 32
      && new Set(allowedRecipients).size === allowedRecipients.length
      && allowedRecipients.every(id => typeof id === 'string' && /^peer:[a-f0-9]{24,64}$/i.test(id)),
    'Allowed recipients must be distinct enrolled peer identities');
    pinned = new Set(allowedRecipients);
  }
  const expectedHeader = `Bearer ${token}`;
  const api = createTextApi({
    participant: host.textParticipant,
    production: true,
    authenticate: async req => tokensEqual(req.headers.authorization, expectedHeader)
      ? { subject: `fleet-api:${host.identity.peerId}` } : null,
    authorize: async check => {
      if (host.textParticipant.executionClass !== 'private-pool') return false;
      if (check.action === 'models.list') return true;
      if (check.action === 'chat.execute') return host.allowsModel(check.request?.model);
      if (check.action === 'chat.recover') return typeof host.recoverAccountedGeneration === 'function';
      if (check.action === 'chat.disclose') {
        const enrolled = await host.enrolledRecipients();
        const recipients = previewRecipients(check.preview);
        return recipients.length > 0 && recipients.every(id => enrolled.has(id) && (!pinned || pinned.has(id)));
      }
      return false;
    },
    accounting: {
      run: (request, controls, execute) => host.runAccountedGeneration(request, controls, execute),
      ...(typeof host.recoverAccountedGeneration === 'function'
        ? { recover: (input, controls, recoverExecution) => host.recoverAccountedGeneration(input, controls, recoverExecution) }
        : {})
    }
  });
  const handle = (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    return api.handle(req, res);
  };
  const server = tls ? https.createServer(tls, handle) : http.createServer(handle);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, listenHost, resolve); });
  const address = server.address();
  const hostText = listenHost.includes(':') ? `[${listenHost}]` : listenHost;
  return Object.freeze({
    url: `${tls ? 'https' : 'http'}://${hostText}:${address.port}/v1`,
    async close() {
      await api.close();
      server.closeIdleConnections();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
