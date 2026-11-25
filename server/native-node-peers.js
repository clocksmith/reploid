/**
 * `reploid peers`: one bounded look at who is in the room now.
 *
 * meshRoster is pure: what a connect-only node observed goes in, a summary and one row per connected
 * computer come out. A computer names a whole model in its advertisement. A split stage is named only in the
 * stage description it gives over the partition control channel, so its advertisement reads like a requester's.
 * "Ready to serve" is never a computer's own word alone: it is the route `ask` would use, askableRoute over
 * the catalog projection every requester reads.
 */
import { setTimeout as delay } from 'node:timers/promises';
import partitionPolicy from '../apps/poolday/config/partition-policy.json' with { type: 'json' };
import { projectChatCatalog } from '../apps/poolday/host/chat-view.js';
import defaultCatalog from '../shared/config/chat-models.json' with { type: 'json' };
import { findCatalogModel, supersededIdentities } from './native-model-names.js';
import { askableRoute } from './native-node-ask.js';

export const PEERS_SCHEMA = 'reploid.peers/v1';
/** The page gives discovery 8 s before it reports that nobody is there (apps/poolday/host/chat-session.js). */
export const PEERS_WAIT_MS = 8000;
export const PEERS_MIN_WAIT_MS = 1000;
/** The transport gives up one connection attempt after 30 s, so a longer wait reaches nobody new. */
export const PEERS_MAX_WAIT_MS = 30000;
/** How long the command may take to start, and again to close, beyond the wait it was given. */
export const PEERS_GRACE_MS = 5000;
// A stage description is asked for on each partition poll; two polls with nothing new is a settled room.
const QUIET_MS = 2 * partitionPolicy.pollMs;

const STATES = ['ready', 'busy', 'loading', 'stage-ready', 'not-usable', 'not-serving', 'files-only', 'connected'];
const READINESS = ['loading', 'ready', 'executing', 'idle', 'failed', 'stopping'];
const STAGE_PHASES = ['idle', 'waiting', 'loading', 'ready', 'stopping', 'failed'];
const PREPARATION = ['downloading', 'receiving', 'cached', 'pipelines', 'loading'];
const CLOSED = ['disconnected', 'failed', 'closed'];
const SHA256 = /^sha256:[a-f0-9]{64}$/, PARTICIPANT = /^peer:[a-f0-9]{24}$/;
// Text from another computer reaches a terminal: printable ASCII only, and bounded.
const plain = (value, limit = 64) => typeof value === 'string' && value ? value.replace(/[^\x20-\x7e]/g, '?').slice(0, limit) : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

/** The catalog entry a computer names. Its manifest hash decides, as it does for a request; the id is used
 * when no hash is given. `earlier` marks a hash or id the catalog lists as replaced (`supersedes`). */
function namedModel(catalog, id, hashes) {
  const current = catalog.find(row => hashes.includes(row.identity));
  if (current) return { entry: current, earlier: false };
  const replaced = catalog.find(row => supersededIdentities(row).some(identity => hashes.includes(identity)));
  if (replaced) return { entry: replaced, earlier: true };
  const named = typeof id === 'string' ? findCatalogModel(catalog, id) : undefined;
  return { entry: named ?? null, earlier: !!named && named.id !== id };
}

/** The whole-model route this one computer gives a requester, or null: the projection `ask` reads, asked
 * about a single advertisement. Without a connection list the projection skips its open-channel test. */
const wholeRoute = (catalog, peer, connections) => projectChatCatalog({ models: catalog, peers: [peer], connections })
  .find(route => !route.adapters?.length && route.providerIds.length) ?? null;

// Explains a refusal the projection already made; it never decides one.
function whyNotUsable(peer, { entry, earlier }, usableWithoutChannelTest) {
  if (usableWithoutChannelTest) return 'no open channel';
  if (!peer.hasInference) return 'reports no loaded model';
  if (peer.blocked === true) return 'blocked on this computer';
  if (peer.unresponsive === true) return 'not answering';
  if (peer.identityProtocol !== 1 || peer.admissionProtocol !== 2) return 'older protocol';
  if (!entry) return 'model not in this catalog';
  if (earlier) return 'earlier release of the model';
  if (typeof peer.model !== 'string') return 'no model id advertised';
  return 'id or files differ from this catalog';
}

function preparationText(preparation) {
  if (!PREPARATION.includes(preparation?.kind)) return null;
  const { kind, receivedBytes, totalBytes, prepared, total } = preparation;
  if (count(receivedBytes) !== null && count(totalBytes) > 0 && receivedBytes <= totalBytes) return `${kind} ${Math.floor(100 * receivedBytes / totalBytes)}%`;
  if (kind === 'pipelines' && count(prepared) !== null && count(total) > 0 && prepared <= total) return `${kind} ${prepared}/${total}`;
  return kind;
}

function hardwareOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = Object.fromEntries(['device', 'description', 'vendor', 'architecture'].map(key => [key, plain(value[key], 160)]).filter(([, text]) => text));
  return Object.keys(fields).length ? fields : null;
}

/**
 * Summary and rows from what one connect-only node observed.
 * `observed.peers` and `observed.connections` are the advertisements and this node's connections to their
 * senders (getNetworkState). `observed.stages` are split-stage descriptions and `observed.routes` the split
 * routes this node could ask (getState().capabilities and its models with a partition). `observed.fileSuppliers`
 * lists connection ids known to offer files; left out, file sharing is unknown and nobody is "files-only".
 * `self.peerId` is this node's own connection, which is never a row; `model` keeps one catalog model's rows.
 */
export function meshRoster(observed = {}, { model = null, self = {}, executionClass = 'public-pool', now = Date.now(),
  catalog = defaultCatalog, shortNames = {} } = {}) {
  const connections = Array.isArray(observed.connections) ? observed.connections : undefined;
  const adverts = new Map((observed.peers || []).filter(peer => typeof peer?.peerId === 'string' && peer.peerId !== self.peerId)
    .map(peer => [peer.peerId, peer]));
  const stages = new Map((observed.stages || []).filter(seen => seen?.available && seen.description?.offer
    && typeof seen.transportId === 'string' && seen.transportId !== self.peerId).map(seen => [seen.transportId, seen]));
  // A split answers only as a complete route, so a stage is ready to serve when `ask` could use a route it is in.
  const routeStages = new Set((observed.routes || []).filter(route => route?.partition && askableRoute(route, executionClass))
    .flatMap(route => route.partition.route?.stages?.map(stage => stage?.participantId) ?? [route.partition.participantA, route.partition.participantB]));
  const suppliers = Array.isArray(observed.fileSuppliers) ? new Set(observed.fileSuppliers) : null;
  const shortName = id => Object.hasOwn(shortNames, id) ? shortNames[id] : null;
  const order = id => { const at = catalog.findIndex(row => row.id === id); return at < 0 ? catalog.length : at; };

  const all = [...new Set([...adverts.keys(), ...stages.keys()])].map(peerId => {
    const peer = adverts.get(peerId) ?? {}, seen = stages.get(peerId), stage = seen?.description ?? null;
    const hashes = [peer.modelIdentity, ...(Array.isArray(peer.executionOffers) ? peer.executionOffers : []).flatMap(offer => offer?.modelIdentities ?? [])]
      .filter(value => SHA256.test(value));
    const whole = typeof peer.model === 'string' || hashes.length > 0;
    const participantId = [peer.participantId, seen?.participantId].find(value => PARTICIPANT.test(value)) ?? null;
    let named = { entry: null, earlier: false }, serves = null, state, detail = null, freeSlots = null;
    if (whole) {
      named = namedModel(catalog, peer.model, hashes); serves = 'whole'; freeSlots = count(peer.availableSlots);
      const route = wholeRoute(catalog, peer, connections);
      if (route && askableRoute(route, executionClass)) state = 'ready';
      else if (route) { state = 'busy'; detail = route.capacityUnknown ? 'free slots not reported' : 'no free slot'; }
      else if (peer.readiness === 'ready') {
        state = 'not-usable'; detail = whyNotUsable(peer, named, connections !== undefined && wholeRoute(catalog, peer, undefined) !== null);
      } else if (peer.readiness === 'loading') { state = 'loading'; detail = preparationText(peer.preparation); }
      else { state = 'not-serving'; detail = READINESS.includes(peer.readiness) ? peer.readiness : 'unavailable'; }
    } else if (stage) {
      named = namedModel(catalog, stage.offer.id, [stage.offer.identity].filter(value => SHA256.test(value)));
      serves = 'stage'; freeSlots = count(stage.capacity?.availableSlots);
      const phase = STAGE_PHASES.includes(stage.phase) ? stage.phase : 'unavailable';
      if (participantId !== null && routeStages.has(participantId)) state = 'ready';
      else if (phase === 'ready' && stage.models?.[0]?.availability !== 'unavailable') state = 'stage-ready';
      else if (phase === 'loading') { state = 'loading'; detail = preparationText(stage.preparation); }
      else { state = 'not-serving'; detail = phase === 'ready' ? 'unavailable' : phase; }
    } else state = suppliers?.has(peerId) ? 'files-only' : 'connected';
    const updatedAt = [peer.updatedAt, seen?.observedAt].find(value => Number.isFinite(value)) ?? null;
    return { participantId, shortId: participantId?.slice(5, 13) ?? null, identityVerified: participantId !== null,
      sameIdentity: participantId !== null && participantId === self.participantId, peerId,
      role: serves ? 'provider' : 'consumer', advertisedRole: plain(peer.role, 16),
      model: named.entry?.id ?? plain(whole ? peer.model : stage?.offer.id), short: named.entry ? shortName(named.entry.id) : null,
      modelIdentity: hashes[0] ?? (SHA256.test(stage?.offer.identity) ? stage.offer.identity : null),
      inCatalog: named.entry !== null, earlierRelease: named.earlier,
      serves, stage: serves === 'stage' ? count(stage.index) : null, state, detail, freeSlots, queuedJobs: count(peer.queuedJobs),
      sharesFiles: suppliers ? suppliers.has(peerId) : null, hardware: hardwareOf(peer.hardware),
      updatedAt, lastSeenMs: updatedAt === null ? null : Math.max(0, now - updatedAt) };
  });

  const key = row => [STATES.indexOf(row.state), order(row.model), row.stage ?? -1];
  const rows = (model ? all.filter(row => row.model === model) : all).sort((a, b) => {
    const left = key(a), right = key(b), at = left.findIndex((value, index) => value !== right[index]);
    return at < 0 ? (a.participantId ?? a.peerId).localeCompare(b.participantId ?? b.peerId) : left[at] - right[at];
  });
  // A model asked for by name is counted even when nobody serves it.
  const modelIds = [...new Set([...(model ? [model] : []), ...rows.map(row => row.model).filter(Boolean)])]
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const listed = new Set(all.map(row => row.peerId));
  return { schema: PEERS_SCHEMA, capturedAt: new Date(now).toISOString(), model,
    summary: { computers: rows.length, visible: all.length, ready: rows.filter(row => row.state === 'ready').length,
      // Connections that are open or opening and have sent no advertisement yet.
      pending: (connections || []).filter(link => typeof link?.id === 'string' && link.id !== self.peerId
        && !CLOSED.includes(link.phase) && !listed.has(link.id)).length,
      models: modelIds.map(id => ({ model: id, short: shortName(id), computers: rows.filter(row => row.model === id).length,
        ready: rows.filter(row => row.model === id && row.state === 'ready').length })) },
    rows };
}

const STATE_TEXT = {
  ready: () => 'ready to serve',
  busy: row => `loaded, ${row.detail}`,
  loading: row => row.detail ? `loading: ${row.detail}` : 'loading',
  'stage-ready': () => 'stage ready, no usable route',
  'not-usable': row => `reports ready, not usable: ${row.detail}`,
  'not-serving': row => `not serving (${row.detail})`,
  'files-only': () => 'sharing files only',
  connected: () => 'connected only',
};
function ago(ms) {
  if (ms === null) return '-';
  if (ms < 1000) return 'now';
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
  return ms < 3600000 ? `${Math.floor(ms / 60000)}m ago` : `${Math.floor(ms / 3600000)}h ago`;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// As the page shows it: the device name, else vendor and architecture. A native adapter's description is
// often its driver, so it is used only when nothing else was reported.
function hardwareText(hardware) {
  const reported = text => !!text && text.toLowerCase() !== 'unknown';
  if (!hardware) return null;
  if (reported(hardware.device)) return hardware.device;
  const family = [hardware.vendor, hardware.architecture].filter(reported).join(' ');
  return family || (reported(hardware.description) ? hardware.description : null);
}

/** The summary line, then one table row per computer. */
export function peersText({ model, summary, rows }) {
  const label = entry => entry.short ?? entry.model;
  const scope = model ? ` for ${label(summary.models.find(entry => entry.model === model) ?? { model })} (${summary.visible} visible)` : '';
  const perModel = summary.models.map(entry => `${label(entry)} ${entry.ready}`).join(', ');
  const lines = [`${plural(summary.computers, 'computer')}${scope}, ${summary.ready} ready to serve${perModel ? ': ' + perModel : ''}.`];
  if (summary.pending) lines.push(`${plural(summary.pending, 'more computer')} had not answered when the wait ended. Try a longer --wait-ms.`);
  if (rows.length) {
    const cells = rows.map(row => [row.role, row.short ?? '-', row.model ?? '-', row.serves === 'stage' ? `stage ${row.stage ?? '?'}` : row.serves ?? '-',
      STATE_TEXT[row.state](row), String(row.freeSlots ?? (row.serves ? '?' : '-')), hardwareText(row.hardware)?.slice(0, 40) ?? '-', ago(row.lastSeenMs),
      (row.shortId ?? '(unproven)') + (row.sameIdentity ? ' (yours)' : '')]);
    cells.unshift(['ROLE', 'SHORT', 'MODEL', 'SERVES', 'STATE', 'FREE', 'HARDWARE', 'LAST SEEN', 'ID']);
    const widths = cells[0].map((_, i) => Math.max(...cells.map(row => row[i].length)));
    lines.push('', ...cells.map(row => row.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd()));
  }
  const notes = [];
  if (rows.some(row => row.state === 'connected' && row.sharesFiles === null)) {
    notes.push('A computer that only shares files is listed as connected only: discovery does not report who offers files.');
  }
  if (rows.some(row => row.sameIdentity)) notes.push('(yours) uses the same identity file as this command.');
  if (notes.length) lines.push('', ...notes);
  return lines.join('\n');
}

/** Watches a connect-only participant until the room has been quiet for `quietMs` or `waitMs` has passed,
 * then returns its roster. Rejects when signaling was not joined in that time. */
export async function observePeers(participant, { model = null, waitMs = PEERS_WAIT_MS, quietMs = QUIET_MS, pollMs = 250,
  signal, shortNames, catalog } = {}) {
  const started = Date.now();
  // This node's own connection id is the custody peer id its identity certifies.
  const certificate = await Promise.resolve(participant.getCustodyCertificate?.()).catch(() => null);
  const options = { self: { peerId: certificate?.custodyPeerId ?? null, participantId: participant.identity },
    executionClass: participant.executionClass, ...(shortNames ? { shortNames } : {}), ...(catalog ? { catalog } : {}) };
  let joined = false, observed, print = null, changedAt = started;
  for (;;) {
    signal?.throwIfAborted();
    const network = participant.getNetworkState(), state = participant.getState();
    joined ||= network.connectionState === 'connected';
    observed = { peers: network.peers, connections: network.connections, stages: state.capabilities,
      routes: (state.models || []).filter(route => route?.partition) };
    const everyone = meshRoster(observed, options);
    // Who is here and what each is doing; a moving load percentage or slot count is not a new arrival.
    const next = JSON.stringify([joined, everyone.rows.map(row => [row.peerId, row.participantId, row.model, row.serves, row.stage, row.state])]);
    if (next !== print) { print = next; changedAt = Date.now(); }
    const elapsed = Date.now() - started;
    if (elapsed >= waitMs || joined && !everyone.summary.pending && Date.now() - changedAt >= quietMs) break;
    await delay(Math.min(pollMs, waitMs - elapsed), undefined, { signal }).catch(error => { signal?.throwIfAborted(); throw error; });
  }
  if (!joined) {
    throw Error(`Could not reach signaling for room ${participant.roomId} within ${Math.round(waitMs / 1000)} s. Run reploid doctor to check the connection.`);
  }
  return { ...meshRoster(observed, { ...options, model }), room: participant.roomId, waitedMs: Date.now() - started };
}
