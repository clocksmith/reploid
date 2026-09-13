export * from './episodes.js';
export { default as ImprovementEpisodeLedger } from './episodes.js';
import ImprovementEpisodeLedger from './episodes.js';

export function createImprovementLedger(ports) {
  if (!ports?.VFS || (!ports.identityBundle && typeof ports.getIdentity !== 'function')) {
    throw new TypeError('Improvement ledger requires explicit VFS and recorder identity ports');
  }
  return ImprovementEpisodeLedger.factory(ports);
}
