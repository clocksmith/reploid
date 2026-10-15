import { createDopplerRuntime } from '../pool/doppler-runtime.js';
/** Application lifetime. Detaching a route never stops an owned conversation or document task. */
import { createReploidDopplerRuntimeService } from '../infrastructure/doppler-runtime-service.js';
import { createWorkSession } from './work-session.js';
import { createWorkEvolution } from './work-evolution.js';
import { createWorkSwarm } from './work-swarm.js';
import { createWorkPeerJobs } from './work-peer-jobs.js';
import { createChatSession, openCanonicalChatSession, LOCAL_HISTORY_IDENTITY } from './chat-session.js';
import { createWebSearch } from './web-search.js';
import { acquireChatHistoryOwner, refusedChatHistory } from './chat-history.js';
import { DOPPLER_PARTITIONS_MODULE_URL } from '../config/doppler-local-models.js';
import orderedPolicy from '../config/ordered-participation.json' with { type: 'json' };
import { startSwarmAutoconnect } from './swarm-autoconnect.js';
import swarmPolicy from '../config/swarm-bootstrap.json' with { type: 'json' };
import { createOperationParticipation } from '../pool/operation-participation.js';
import { createOperationRoomNetwork } from '../pool/operation-room-network.js';
import { createRequesterClient } from '../pool/requester-client.js';
import { createPoolIdentity } from '../pool/identity.js';
import { createLocalPackExecutor } from '../pool/local-pack-executor.js';
import { createDocumentAssistant } from '../pool/document-delegation.js';
import poolConfiguration from '../pool/pool-config.json' with { type: 'json' };

const HISTORY_OWNED_ELSEWHERE = 'Another tab owns this conversation history';
const ordinaryReason = cause => `History stays ordinary: ${cause}; ordered answers are not published to requester-owned storage.`;

/** Requester-owned history for ordered sessions. Ordered publication needs only
 * Doppler's metadataDigest; without it, or without Web Locks to keep one history
 * owner per browser profile, history stays ordinary and says so in state. */
async function openOrderedRequesterChat({ chatOptions, requesterIdentity, ports }) {
  const { loadRuntime = () => import(DOPPLER_PARTITIONS_MODULE_URL), locks = globalThis.navigator?.locks, openStore } = ports;
  const ordinary = reason => createChatSession({ ...chatOptions, requesterIdentity,
    history: { mode: 'ordinary', publication: null, reason: ordinaryReason(reason) } });
  let runtime;
  try { runtime = await loadRuntime(); }
  catch (error) { return ordinary(`the Doppler partitions runtime did not load (${error?.message || error})`); }
  if (typeof runtime?.metadataDigest !== 'function') return ordinary('the installed Doppler runtime exposes no metadataDigest');
  if (typeof locks?.request !== 'function') return ordinary('this browser cannot lock one history owner per profile');
  const { database, ...bounds } = orderedPolicy.requesterHistory;
  const release = await acquireChatHistoryOwner({ name: database, locks });
  if (!release) return createChatSession({ ...chatOptions, requesterIdentity,
    canonicalHistory: refusedChatHistory({ ...LOCAL_HISTORY_IDENTITY, reason: HISTORY_OWNED_ELSEWHERE }),
    history: { mode: 'refused', publication: 'ordered', reason: HISTORY_OWNED_ELSEWHERE } });
  // The existing localStorage workspace and drafts migrate once through the legacy import.
  return openCanonicalChatSession({ ...chatOptions, ...LOCAL_HISTORY_IDENTITY, requesterIdentity,
    history: { mode: 'transactional', publication: 'ordered',
      reason: 'Only prepared ordered routes publish into this history; local and whole-request models are unavailable.' },
    canonical: { name: database, ...bounds, runtime, publication: 'ordered', expectedWriterEpoch: 'stored', release,
      ...(openStore ? { openStore } : {}) } });
}

export function createProductSession({ storage, networkOptions, swarmNetworkOptions, operationNetwork = null,
  canonical = null, ordered = null, eventTarget = window, onChanges = () => {}, onDocuments = () => {}, onSharing = () => {},
  historyPorts = {} }) {
  let runtime, work, chat, documents, operationSharing, closed = false, closing, ownsNetwork = false;
  const service = createReploidDopplerRuntimeService();
  const evolution = createWorkEvolution({ storage, isBusy: () => work?.getState().anyBusy === true, onChange: onChanges });
  // Bootstrap and ICE belong to the swarm host, independently of signed job routing.
  const swarm = createWorkSwarm({ storage, evolution, service, networkOptions: swarmNetworkOptions, canonical, ordered,
    onChange: () => chat?.refreshNetwork() });
  const getNetwork = () => {
    if (!operationNetwork) {
      operationNetwork = createOperationRoomNetwork({ ...networkOptions(),
        requesterClient: createRequesterClient({ sdk: null, identity: createPoolIdentity('requester', {
          localOnly: true, namespace: poolConfiguration.operationNetwork.identityNamespace }) }) });
      ownsNetwork = true;
    }
    return operationNetwork;
  };
  // The person's MCP search server, used only for sends made while web search is on (Settings).
  const webSearch = createWebSearch({ storage });
  const chatOptions = { service, storage, swarm, partitions: swarm.partitions, peers: createWorkPeerJobs({ getNetwork }),
    retrieval: { provider: webSearch.provider } };
  const failOpening = async error => {
    const settled = await Promise.allSettled([() => swarm.close(), () => chat?.close()].map(close => Promise.resolve().then(close)));
    const failures = settled.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError([error, ...failures], 'Canonical application opening failed');
    throw error;
  };
  if (canonical) return openCanonicalChatSession({ ...chatOptions, canonical,
    meshId: canonical.meshId, participantId: canonical.participantId }).then(finish).catch(failOpening);
  // Canonical participants are the authenticated swarm peer (work-swarm.js refuses another). Local
  // history keeps its stable owner; ordered disclosure binds the identity the swarm's partition owner uses.
  const requesterIdentity = () => swarm.partitions.requesterIdentity();
  if (ordered) return openOrderedRequesterChat({ chatOptions, requesterIdentity, ports: historyPorts }).then(finish).catch(failOpening);
  return finish(createChatSession({ ...chatOptions, requesterIdentity }));
  function finish(openedChat) {
    chat = openedChat;
    const autoconnect = startSwarmAutoconnect({ connect: options => swarm.connect(options),
      enabled: () => swarm.autoConnectEnabled(), isConnected: () => {
        const state = swarm.getState();
        return state.connecting || ['connected', 'connecting', 'retrying'].includes(state.consumer?.connectionState);
      }, policy: swarmPolicy, eventTarget,
      onError: error => console.warn('[Reploid Swarm] Discovery connection failed', error) });
    const assertOpen = () => { if (closed) throw new Error('Application session is closed'); };
    return {
      chat, swarm, evolution, webSearch,
      get runtime() { assertOpen(); return runtime ??= globalThis.REPLOID_DOPPLER_RUNTIME || createDopplerRuntime(); },
      get work() { assertOpen(); return work ??= createWorkSession({ service, storage, swarm, evolution, peers: createWorkPeerJobs({ getNetwork }) }); },
      get documents() { assertOpen(); return documents ??= createDocumentAssistant({ executor: createLocalPackExecutor(), network: getNetwork(), onChange: onDocuments }); },
      get operationSharing() { assertOpen(); return operationSharing ??= createOperationParticipation({ networkOptions, onChange: onSharing }); },
      connectOperations(network) { assertOpen(); if (ownsNetwork) void operationNetwork?.close?.(); ownsNetwork = false; operationNetwork = network; documents?.connectNetwork(network); },
      resume() { if (!closed) autoconnect.resume(); },
      async pause() {
        autoconnect.pause(); work?.cancelAll(); chat.cancelAll(); documents?.cancel();
        return Promise.allSettled([swarm.disconnect({ automatic: true }), operationSharing?.stop()]);
      },
      close() {
        if (closing) return closing;
        closed = true; autoconnect.close();
        // Requester-owned history must report unsettled cleanup; ordinary history never did.
        const requesterOwned = !!canonical || chat.getState?.().history?.mode === 'transactional';
        const owners = [() => swarm.close(), () => work?.close(), () => chat.close(), () => documents?.close(),
          () => operationSharing?.stop(), () => ownsNetwork ? operationNetwork?.close?.() : undefined];
        closing = Promise.allSettled(owners.map(close => Promise.resolve().then(close))).then(results => {
          const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
          if (requesterOwned && failures.length) throw new AggregateError(failures, 'Canonical application cleanup failed');
          return results;
        }).catch(error => { closing = null; throw error; });
        return closing;
      }
    };
  }
}
