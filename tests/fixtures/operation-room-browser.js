/** Synthetic model outputs; real discovery, signaling, WebRTC and IndexedDB. */
import config from '../../self/pool/pool-config.json' with { type: 'json' };
import { createOperationRoomNetwork } from '../../self/pool/operation-room-network.js';
import { createOperationParticipation } from '../../self/pool/operation-participation.js';
import { createBroadcastPeerRoomBus } from '../../self/pool/peer-rendezvous.js';
import { createRequesterClient } from '../../self/pool/requester-client.js';
import { createDocumentAssistant } from '../../self/pool/document-delegation.js';
import { createLocalPackExecutor } from '../../self/pool/local-pack-executor.js';
import { packPeerModel } from '../../self/pool/peer-pack-job.js';
import { createDocumentPackFixture } from './document-packs.js';
import { packPeerIdentity, operationCapabilities } from './peer-pack-operation.js';
import { renderDocumentSearch, bindDocumentSearch, refreshDocumentSearch } from '../../self/ui/pool-home/document-search.js';
import { renderOperationSharing, bindOperationSharing, refreshOperationSharing } from '../../self/ui/pool-home/operation-sharing.js';

let provider, workflow, fixture, unbind;
const relay = [], errors = [];
function roomBusFactory(options) {
  const bus = createBroadcastPeerRoomBus(options);
  const send = bus.postMessage.bind(bus);
  return { ...bus, postMessage: message => { relay.push(structuredClone(message)); return send(message); } };
}
export async function start({ role, roomId }) {
  fixture = await createDocumentPackFixture({ answerText: role === 'provider' ? 'A public drafting suggestion.' : 'Private apple evidence. [1]' });
  const policy = { ...config.operationNetwork, discoveryMs: 200,
    requestLimits: { ...config.operationNetwork.requestLimits, maxJobMs: 30000 } };
  const executor = createLocalPackExecutor({ service: fixture.service });
  const shared = { roomId, roomBusFactory, rtcConfig: { iceServers: [] }, policy };
  if (role === 'provider') {
    document.body.innerHTML = renderOperationSharing();
    provider = createOperationParticipation({ networkOptions: () => shared, executorFactory: () => executor,
      onChange: state => refreshOperationSharing(document, state) });
    unbind = bindOperationSharing(document, provider); return;
  }
  const network = createOperationRoomNetwork({ ...shared, requesterClient: createRequesterClient({ identity: null }) });
  document.body.innerHTML = renderDocumentSearch();
  document.querySelector('[data-document-search]').hidden = false;
  workflow = createDocumentAssistant({ executor, network,
    onChange: state => refreshDocumentSearch(document, state) });
  unbind = bindDocumentSearch(document, workflow);
  workflow.configure(fixture.configuration);
  await workflow.setDocuments([{ name: 'PRIVATE-FILENAME.md', text: 'PRIVATE-SOURCE-TRIPWIRE: apple evidence.' }]);
  await workflow.search({ query: 'PRIVATE-QUESTION-TRIPWIRE apple' });
}
export function state() { return { errors, relay, calls: fixture.calls,
  workflow: workflow?.getState() ?? null, provider: provider?.getState() ?? null }; }
export const prepare = task => workflow.prepareDelegation({ task });
export const approve = approval => workflow.approveDelegation(approval);
export const cancel = () => workflow.cancel();
export const configuration = () => fixture.configuration;
export const search = query => workflow.search({ query });
export async function close() { unbind?.(); await workflow?.close(); await provider?.close(); }
