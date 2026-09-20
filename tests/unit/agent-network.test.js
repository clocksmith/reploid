import { describe, it, expect } from 'vitest';
import { projectAgents } from '../../self/ui/pool-home/agent-network.js';
const model = { id: 'local', name: 'Local model', provider: 'doppler' };
const work = { models: [model, { id: 'cloud', name: 'Cloud model', provider: 'gemini' }], records: [], available: true };
describe('observed agent network', () => {
  it('does not confuse selection, loading, task execution or cloud location', () => {
    expect(projectAgents(work)[0].state).toBe('No model selected');
    expect(projectAgents(work, {}, 'local')[0]).toMatchObject({ state: 'Idle · model selected', location: 'This device' });
    const active = { ...work, busy: true, activeId: 'task', activity: 'Reading file', records: [{ id: 'task', modelId: 'cloud', status: 'loading' }] };
    expect(projectAgents(active, {}, 'local')[0]).toMatchObject({ state: 'Preparing model', location: 'Cloud' });
    active.records[0].status = 'running';
    expect(projectAgents(active, {}, 'local')[0].state).toBe('Reading file');
    active.pendingApproval = {};
    expect(projectAgents(active, {}, 'local')[0].state).toBe('Awaiting approval');
  });
  it('deduplicates peer advertisements and excludes both local identities', () => {
    const peers = [{ peerId: 'own-supplier', role: 'provider' }, { peerId: 'remote', role: 'provider', model: 'Remote model' }];
    const swarm = { consumer: { peerId: 'own-consumer', transport: 'webrtc', peers }, supplier: { peerId: 'own-supplier', transport: 'webrtc', peers } };
    const rows = projectAgents(work, swarm, 'local');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ model: 'Remote model', state: 'Available offer', location: 'WebRTC peer' });
  });
  it('does not call same-browser advertisements remote WebRTC or missing offers available', () => {
    const rows = projectAgents({ ...work, peerModels: [{ available: false, modelId: 'missing' }] }, { consumer: { peers: [{ peerId: 'tab', role: 'consumer' }] } }, 'local');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ state: 'Connected agent', location: 'Same browser', model: 'No model offered' });
  });
  it('includes admitted operation offers and task helpers without claiming independent peers', () => {
    const state = { ...work, peerModels: [{ available: true, providerId: 'provider', modelId: 'encoder', operation: 'embed' }], busy: true, activeId: 'task',
      records: [{ id: 'task', modelId: 'local', modelName: 'Local model', helpers: [{ id: 'helper', goal: 'Read input', location: 'this device', status: 'running' }] }] };
    const rows = projectAgents(state, {}, 'local');
    expect(rows[1]).toMatchObject({ model: 'encoder', state: 'Compatible operation offered' });
    expect(rows[2]).toMatchObject({ name: 'Helper 1', location: 'this device', state: 'running: Read input' });
  });
});
