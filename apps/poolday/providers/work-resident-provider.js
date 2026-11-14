/** Browser host composes runtime construction and origin-wide storage leases. */
import { createResidentExecution } from '../../../shared/vendor/reploid/adapters/resident.js';
import { openWorkProvider } from './work-provider.js';
import { retainModelStorage } from '../infrastructure/model-storage-lock.js';

export function createWorkResidentProvider(options) {
  return createResidentExecution({ ...options, openProvider: openWorkProvider, acquireStorage: retainModelStorage });
}
