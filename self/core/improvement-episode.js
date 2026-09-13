import { ImprovementEpisodeLedger } from '../vendor/reploid/improvement/index.js';
import { ensureIdentityBundle } from '../identity.js';
import { getCurrentReploidInstanceId } from '../instance.js';

export * from '../vendor/reploid/improvement/index.js';
export default {
  ...ImprovementEpisodeLedger,
  factory: deps => ImprovementEpisodeLedger.factory({
    ...deps,
    getIdentity: deps.getIdentity || (({ cryptoApi }) => ensureIdentityBundle({
      instanceId: getCurrentReploidInstanceId() || 'default', cryptoApi
    }))
  })
};
