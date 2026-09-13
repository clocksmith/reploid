import { createReploid } from 'reploid';
import { resolveConfig } from 'reploid/config';
import { createMemoryStore } from 'reploid/browser';

const store = createMemoryStore();
const config = resolveConfig({ overrides: { tools: { allowed: ['Observe'] }, models: { providerId: 'deterministic-fixture' }, memory: { storeId: 'memory' } } });
const agent = createReploid({
  config, ports: {
    instanceId: 'standalone-consumer', stores: { memory: store }, owned: [store],
    authorize: request => request.action === 'agent.execute' || (request.action === 'tool.execute' && request.name === 'Observe'),
    tools: { Observe: async () => ({ observation: 'The workshop has one unpowered machine.' }) },
    providers: { 'deterministic-fixture': { async generate(messages, _onUpdate, { signal }) {
      signal.throwIfAborted();
      return { raw: messages.some(message => message.origin === 'tool')
        ? 'REPLOID/0\nIDLE: Observation recorded; host review required.'
        : 'REPLOID/0\nTOOL: Observe' };
    } } }
  }
});
const output = document.querySelector('#state');
agent.subscribe(state => { output.textContent = JSON.stringify(state, null, 2); });
document.querySelector('#run').onclick = () => agent.execute({ goal: 'Observe the workshop.' }).catch(error => { output.textContent = error.message; });
document.querySelector('#cancel').onclick = () => agent.cancel();
document.querySelector('#close').onclick = () => agent.close().then(() => { output.textContent = 'Closed'; });
