import { createSwarmTransport } from '../../vendor/reploid/transport/index.js';
import { createLegacyNetworkOptions } from './library-adapter.js';

export default {
  metadata: { id: 'SwarmTransport', version: '1.0.0', genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus'], async: true, type: 'capability' },
  factory: deps => createSwarmTransport(createLegacyNetworkOptions(deps))
};
