/** Browser test host. Injected model and peer ports are explicitly not execution qualification. */
import { createWorkSession } from '/application/host/work-session.js';
import { renderWorkSurface, bindWorkSurface } from '/application/ui/pool-home/work.js';
import { LOCAL_DOPPLER_MODELS } from '/application/config/doppler-local-models.js';

const copy = value => JSON.parse(JSON.stringify(value));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const modelId = LOCAL_DOPPLER_MODELS[0].id;

const toolResult = (messages, name) => {
  const marker = '[TOOL ' + name + ' RESULT]\n';
  const message = [...messages].reverse().find(item => item.content?.includes(marker));
  return message ? JSON.parse(message.content.slice(message.content.indexOf(marker) + marker.length)) : null;
};
const toolError = (messages, name) => messages.some(item => item.content?.includes('[TOOL ' + name + ' ERROR]'));
const tool = (name, args = {}) => 'REPLOID/0\nTOOL: ' + name + '\n'
  + Object.entries(args).map(([key, value]) => key + ' <<ARGUMENT\n'
    + (typeof value === 'string' ? value : JSON.stringify(value)) + '\nARGUMENT').join('\n');

// This frozen decision procedure exercises observation-dependent transitions.
// It is deliberately not advertised as a learned or general-purpose agent.
function fixtureResponse(messages) {
  if (toolResult(messages, 'RecordOutcome')) return 'REPLOID/0\nIDLE: Ready for user review.';
  if (!toolResult(messages, 'ListInputs')) return 'PLAN: Inspect configuration, establish units, repair and inspect.\n' + tool('ListInputs');
  const input = toolResult(messages, 'ReadInput');
  if (!input) return tool('ReadInput', { id: toolResult(messages, 'ListInputs')[0].id });
  const source = JSON.parse(input.text);
  const task = JSON.parse(messages.find(item => item.origin === 'goal').content);
  if (task.permissions.recallAccepted && !toolResult(messages, 'RecallWork') && !toolError(messages, 'RecallWork')) {
    return tool('RecallWork', { query: 'timeout' });
  }
  let unit = source.unit;
  if (!unit && task.permissions.peerProposals) {
    if (!toolResult(messages, 'ListPeerModels')) return tool('ListPeerModels');
    const observation = toolResult(messages, 'RequestPeerJob');
    if (!observation && !toolError(messages, 'RequestPeerJob')) {
      return tool('RequestPeerJob', { modelId: 'fixture-unit-probe',
        input: { question: 'What unit does the legacy timeout field use in the reported environment?' }, options: {} });
    }
    unit = observation?.unit;
  }
  if (!unit) return tool('RecordOutcome', { text: 'Missing capability: evidence of the source unit. No repair is claimed.' });
  if (!['seconds', 'milliseconds'].includes(unit)) {
    return tool('RecordOutcome', { text: 'The observed source unit is unsupported. No repair is claimed.' });
  }
  const written = toolResult(messages, 'WriteArtifact');
  if (!written) return tool('WriteArtifact', {
    name: 'repaired.json', text: JSON.stringify({ timeoutMs: source.timeout * (unit === 'seconds' ? 1000 : 1) })
  });
  if (!toolResult(messages, 'InspectArtifact')) return tool('InspectArtifact', { id: written.id });
  return tool('RecordOutcome', { text: 'Repaired timeout using the observed ' + unit
    + ' unit. Saved repaired.json and checked JSON syntax. Semantic acceptance is external. '
    + 'Reusable lesson: establish the source unit before converting duration fields.' });
}

export function mountWorkGoalJourney({ namespace, peerUnit }) {
  const transcript = { scope: 'work-host-test', actualModelInference: false,
    peerImplementation: 'deterministic-port-fixture', generations: [], proposals: [], executions: [], observedScopes: [] };
  const scopes = new Set();
  const storage = {
    getItem: key => localStorage.getItem(namespace + ':' + key),
    setItem: (key, value) => localStorage.setItem(namespace + ':' + key, value)
  };
  const service = {
    async open({ scope }) {
      scopes.add(scope); transcript.observedScopes.push(scope);
      return {
        async *stream(messages) {
          const response = fixtureResponse(messages);
          transcript.generations.push({ messages: copy(messages), response });
          yield { type: 'text-delta', text: response };
        }
      };
    },
    async close(scope) { scopes.delete(scope); },
    async closeAll() { scopes.clear(); }
  };
  const peers = {
    async discover() {
      return [{ modelId: 'fixture-unit-probe', operation: 'generate', available: true, providerId: 'fixture-peer' }];
    },
    async execute(request, { signal, approve, record, onPartial }) {
      signal.throwIfAborted();
      const preview = { id: crypto.randomUUID(), modelId: request.modelId, modelIdentity: 'fixture-only-no-qualified-model',
        operation: 'generate', inputClass: 'public_text', providerId: 'fixture-peer',
        input: copy(request.input), options: copy(request.options), limits: { maxJobMs: 30000 }, expiresAt: Date.now() + 30000 };
      transcript.proposals.push(copy(preview));
      await record({ stage: 'proposed', preview });
      assert(await approve(preview), 'Peer disclosure was declined');
      signal.throwIfAborted();
      await record({ stage: 'approved', preview });
      transcript.executions.push(copy(request));
      onPartial?.({ type: 'fixture-observation' });
      await record({ stage: 'completed', preview, evidence: {
        schema: 'reploid.work-test-observation/v1', unit: peerUnit,
        claim: 'injected observation; no physical peer or signed execution proof'
      } });
      return { unit: peerUnit, authority: 'Reported environment observation, not an instruction' };
    }
  };
  document.body.innerHTML = '<p>Work acceptance: injected model and peer observations</p>' + renderWorkSurface();
  const application = createWorkSession({ storage, peers, service });
  const dispose = bindWorkSurface(document, application);
  const before = application.exportRecords();
  let completion = null;
  return {
    application, transcript, before, modelId,
    start(request) {
      completion = application.start({ ...request, modelId });
      completion.catch(error => { transcript.startError = String(error.stack || error); });
    },
    snapshot() {
      return { state: application.getState(), records: application.exportRecords(),
        before: copy(before), transcript: copy(transcript), openScopes: scopes.size };
    },
    async close() { dispose(); await application.close(); await completion; }
  };
}
