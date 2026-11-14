/** Native composition uses the same resident owner with an explicit disk-storage lifetime. */
import { createResidentExecution } from '../packages/reploid/src/adapters/resident-execution.js';
import { openScopedModelProvider } from '../shared/infrastructure/scoped-model-provider.js';

export function createNativeResidentProvider({ providerPolicy, ...options }) {
  return createResidentExecution({ ...options,
    openProvider: selected => openScopedModelProvider({ ...selected, providerPolicy }),
    acquireStorage: async () => () => {} });
}
