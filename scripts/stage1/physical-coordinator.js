/** The credit ledger and signaling for a physical Stage 1 run, on the operator machine, behind a pinned private CA. */
import { X509Certificate, createPrivateKey, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import path from 'node:path';
import SignalingServer from '../../server/signaling-server.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { startFleetService } from '../../server/fleet/service.js';
import { STAGE1_CLOCK_SKEW_MS } from './physical-config.js';

const refuse = reason => { throw Object.assign(Error(`coordinator-tls-refused: ${reason}`), { code: 'coordinator-tls-refused' }); };

/** The certificate must chain to the pinned CA, name the address hosts dial, be current, and match its key. */
export function verifyCoordinatorTls({ key, cert, ca, publicHost, now = Date.now() }) {
  let certificate, authority;
  try { certificate = new X509Certificate(cert); authority = new X509Certificate(ca); } catch { refuse('unreadable certificate'); }
  if (!certificate.verify(authority.publicKey)) refuse('the certificate is not issued by the pinned CA');
  if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) refuse('the certificate is outside its validity');
  const names = isIP(publicHost) ? certificate.checkIP(publicHost) : certificate.checkHost(publicHost);
  if (!names) refuse('the certificate does not name the coordinator address');
  try { if (!certificate.checkPrivateKey(createPrivateKey(key))) refuse('the key does not match the certificate'); }
  catch (error) { if (error.code === 'coordinator-tls-refused') throw error; refuse('unreadable key'); }
}

async function readPrivateKey(file) {
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || (stat.mode & 0o077) !== 0) refuse('the key file must be private to its owner');
  return fs.readFile(file);
}

/**
 * `peers` maps requester, host-a, host-b and, when configured, earner to the verified `{ participantId, publicJwk }`
 * each agent proved. The earner is enrolled under the requester's computer; `buyer` is the coordinator-side account the
 * earner serves, and `earnModel` the whole model it serves.
 */
export async function startPhysicalCoordinator({ config, peers, directory, expectations, model, fixture, buyer = null, earnModel = null,
  onSecret = () => {} }) {
  const { coordinator, credit } = config;
  const [key, cert, ca] = await Promise.all([readPrivateKey(coordinator.tls.keyFile), fs.readFile(coordinator.tls.certFile), fs.readFile(coordinator.tls.caFile)]);
  verifyCoordinatorTls({ key, cert, ca, publicHost: coordinator.publicHost });
  const roomId = 'reploid-swarm-stage1-' + randomUUID(), roomToken = randomBytes(24).toString('hex'), accessToken = randomBytes(32).toString('hex');
  onSecret(roomToken); onSecret(accessToken);
  const ledgerFile = path.join(directory, 'credits.sqlite');
  const credits = await openFleetCredits({ file: ledgerFile,
    computers: [...['requester', 'host-a', 'host-b'].map(label => ({ id: `computer-${label}`, name: label, ownerId: `owner-${label}`,
      providers: [{ participantId: peers[label].participantId, publicJwk: peers[label].publicJwk },
        ...(label === 'requester' && peers.earner ? [{ participantId: peers.earner.participantId, publicJwk: peers.earner.publicJwk }] : [])] })),
    ...(buyer ? [{ id: 'computer-buyer', name: 'buyer', ownerId: 'owner-buyer', providers: [{ participantId: buyer.participantId, publicJwk: buyer.publicJwk }] }] : [])],
    policy: { schema: 'reploid.service-credit-policy/v1', version: 'stage1-physical/1', unit: 'noncash-service-credit',
      creditsPerOutputToken: expectations.creditsPerOutputToken, maxDebt: credit.maxDebt, maxOutputTokens: fixture.maxOutputTokens,
      maxPendingPerComputer: 2, maxClockSkewMs: credit.maxClockSkewMs ?? STAGE1_CLOCK_SKEW_MS, maxRequestMs: credit.maxRequestMs, allowSameOwner: false, wholeModelTerminalCharge: 0,
      partitionUnclaimedReleaseMs: credit.partitionUnclaimedReleaseMs } });
  let service = null, server = null, signaling = null;
  const close = async () => {
    await Promise.resolve().then(() => service?.close()).catch(() => {});
    service = null;
    try { signaling?.close(); } catch { /* already closed */ }
    signaling = null;
    if (server?.listening) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
    server = null;
    try { credits.close(); } catch { /* already closed */ }
  };
  try {
    service = await startFleetService({ credits, models: [{ ...model, plans: [{ id: model.partitionPlanId, creditWeights: [...credit.weights] }] },
      ...(earnModel ? [{ id: earnModel.id, identity: earnModel.identity }] : [])],
      placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 },
      listenHost: coordinator.listenHost, port: coordinator.servicePort, tls: { key, cert } });
    signaling = new SignalingServer({ path: '/swarm', localOnly: false, allowedOrigins: ['http://localhost:8000'], accessToken, logger: { info() {}, log() {}, debug() {}, warn() {}, error() {} } });
    server = https.createServer({ key, cert }, (_request, response) => { response.statusCode = 404; response.end(); });
    server.on('upgrade', (request, socket, head) => {
      if (signaling.shouldHandle(request)) signaling.handleUpgrade(request, socket, head); else socket.destroy();
    });
    server.listen(coordinator.signalingPort, coordinator.listenHost);
    await once(server, 'listening');
  } catch (error) { await close(); throw error; }
  const dialed = coordinator.publicHost.includes(':') ? `[${coordinator.publicHost}]` : coordinator.publicHost;
  return { credits, ledgerFile, roomId, roomToken, serviceCa: ca.toString('utf8'),
    serviceUrl: `https://${dialed}:${new URL(service.url).port}/v1/fleet`,
    signalingUrl: `wss://${dialed}:${server.address().port}/swarm?access_token=${accessToken}`, close };
}
