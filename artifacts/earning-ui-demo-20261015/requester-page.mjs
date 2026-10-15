// Requester harness page for the local earning UI demonstration (served by demo.mjs at /__earning-demo on
// the local server's origin; not product code). It composes the shipped modules: the browser credits
// composition (host/credits/browser.js) with this browser profile's stored sign-in, the chat session and
// conversation workspace, the one-time remote contributor permission dialog and the Settings Credits panel.
// Only the partition port differs from the app: instead of the Poolday mesh it reaches the native
// contributor process's fixture route over a loopback WebSocket, carrying approval, state, deltas and
// activity exactly as the ordered requester port does.
import { openBrowserEarning } from '/host/credits/browser.js';
import { createChatSession } from '/host/chat-session.js';
import { renderConversationWorkspace, bindConversationWorkspace } from '/ui/pool-home/conversation-workspace.js';
import { renderNetworkInspector, bindNetworkInspector } from '/ui/pool-home/network-inspector.js';

const bridge = document.documentElement.dataset.bridge;
const plain = value => JSON.parse(JSON.stringify(value));

function bridgePort(requesterId, model) {
  return Object.freeze({
    getModels: () => [{ ...model, availability: 'ready' }],
    subscribe(listener) { listener(this.getModels()); return () => {}; },
    requesterIdentity: () => requesterId,
    generate(request, controls) {
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(bridge);
        const abort = () => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'abort' }));
        controls.signal?.addEventListener('abort', abort, { once: true });
        socket.onopen = () => socket.send(JSON.stringify({ type: 'generate', requesterId,
          request: plain({ threadId: request.threadId, attemptId: request.attemptId, messages: request.messages, placementGeneration: request.placementGeneration ?? 0 }) }));
        socket.onmessage = async ({ data }) => {
          const message = JSON.parse(data);
          if (message.type === 'approval') {
            const value = await controls.requestApproval(message.preview);
            // After approval the earning attempt has bound the reservation and, under evidence terms, signed the charge binding.
            socket.send(JSON.stringify({ type: 'approval', value, charge: value === true && controls.charge ? plain(controls.charge) : null }));
          } else if (message.type === 'output') {
            const acknowledged = controls.onOutput ? await controls.onOutput(message.record) : undefined;
            socket.send(JSON.stringify({ type: 'acknowledged', id: message.id, value: acknowledged === undefined ? null : plain(acknowledged) }));
          }
          else if (message.type === 'state') controls.onState?.(message.envelope);
          else if (message.type === 'delta') controls.onDelta?.(message.envelope);
          else if (message.type === 'activity') controls.onActivity?.(message.envelope);
          else if (message.type === 'result') { socket.close(); resolve(message.result); }
          else if (message.type === 'error') { socket.close(); reject(Object.assign(new Error(message.message), message.code ? { code: message.code } : {})); }
        };
        socket.onerror = () => reject(new Error('The contributor bridge is unreachable'));
      });
    }
  });
}

const modelFor = requesterId => new Promise((resolve, reject) => {
  const socket = new WebSocket(bridge);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'model', requesterId }));
  socket.onmessage = ({ data }) => { socket.close(); resolve(JSON.parse(data).model); };
  socket.onerror = () => reject(new Error('The contributor bridge is unreachable'));
});

const memory = () => { const map = new Map(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key) }; };

const earning = await openBrowserEarning({ storage: globalThis.localStorage });
if (!earning) throw new Error('This server publishes no earning service');
const model = await modelFor(earning.identity.peerId);
const session = createChatSession({ storage: memory(), models: [], meshId: 'earning-ui-demo', partitions: bridgePort(earning.identity.peerId, model),
  requesterIdentity: () => earning.identity.peerId, earning: earning.earning, service: { open() { throw new Error('Whole-model execution is not part of this demonstration'); } } });
// The same arrangement as the app's home route (ui/pool-home/index.js): the conversation workspace and the
// shared network inspector, whose Settings tab holds the Credits panel bound to this page's earning composition.
document.documentElement.classList.add('pool-page');
document.documentElement.dataset.poolRouteId = 'home';
document.body.dataset.poolRouteId = 'home';
document.body.innerHTML = `<main class="pool-home" data-pool-route-id="home"><div class="pool-route-content">${renderConversationWorkspace({ inspector: false })}</div>
  <div data-shell-inspector>${renderNetworkInspector()}</div></main>`;
const inspector = bindNetworkInspector(document.querySelector('[data-shell-inspector]'), session, { earning: Promise.resolve(earning) });
bindConversationWorkspace(document.querySelector('.pool-route-content'), session, { inspector });
window.earningDemo = { session, earning, model, ready: true };
