import { createDopplerRuntime } from '../pool/doppler-runtime.js';
/** Application lifetime. Detaching a route never stops an owned conversation or document task. */
import { createReploidDopplerRuntimeService } from '../infrastructure/doppler-runtime-service.js';
import { createWorkSession } from './work-session.js';
import { createWorkEvolution } from './work-evolution.js';
import { createWorkSwarm } from './work-swarm.js';
import { createWorkPeerJobs } from './work-peer-jobs.js';
import { createChatSession } from './chat-session.js';
import { startSwarmAutoconnect } from './swarm-autoconnect.js';
import swarmPolicy from '../config/swarm-bootstrap.json' with { type: 'json' };
import { createOperationParticipation } from '../pool/operation-participation.js';
import { createOperationRoomNetwork } from '../pool/operation-room-network.js';
import { createRequesterClient } from '../pool/requester-client.js';
import { createPoolIdentity } from '../pool/identity.js';
import { createLocalPackExecutor } from '../pool/local-pack-executor.js';
import { createDocumentAssistant } from '../pool/document-delegation.js';
import poolConfiguration from '../pool/pool-config.json' with { type: 'json' };

export function createProductSession({ storage, networkOptions, operationNetwork = null,
  eventTarget = window, onChanges = () => {}, onDocuments = () => {}, onSharing = () => {} }) {
  let runtime, work, chat, documents, operationSharing, closed = false, closing, ownsNetwork = false;
  const service = createReploidDopplerRuntimeService();
  const evolution = createWorkEvolution({ storage, isBusy: () => work?.getState().anyBusy === true, onChange: onChanges });
  const swarm = createWorkSwarm({ storage, evolution, service, onChange: () => chat?.refreshNetwork() });
  const getNetwork = () => {
    if (!operationNetwork) {
      operationNetwork = createOperationRoomNetwork({ ...networkOptions(),
        requesterClient: createRequesterClient({ sdk: null, identity: createPoolIdentity('requester', {
          localOnly: true, namespace: poolConfiguration.operationNetwork.identityNamespace }) }) });
      ownsNetwork = true;
    }
    return operationNetwork;
  };
  chat = createChatSession({ service, storage, swarm, partitions: swarm.partitions,
    peers: createWorkPeerJobs({ getNetwork }) });
  const autoconnect = startSwarmAutoconnect({ connect: options => swarm.connect(options),
    enabled: () => swarm.autoConnectEnabled(), isConnected: () => {
      const state = swarm.getState();
      return state.connecting || ['connected', 'connecting', 'retrying'].includes(state.consumer?.connectionState);
    }, policy: swarmPolicy, eventTarget,
    onError: error => console.warn('[Reploid Swarm] Discovery connection failed', error) });
  const assertOpen = () => { if (closed) throw new Error('Application session is closed'); };
  return {
    chat, swarm, evolution,
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
      closing = Promise.allSettled([swarm.close(), work?.close(), chat.close(), documents?.close(), operationSharing?.stop(), ownsNetwork ? operationNetwork?.close?.() : undefined]);
      return closing;
    }
  };
}
