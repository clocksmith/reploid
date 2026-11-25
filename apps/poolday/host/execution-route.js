/**
 * The `execution.route` a conversation request sends. The thread stores its layered policy and its execution
 * location; the route follows from them, so it is explicit on every request and never left to the executor:
 *  - a local-only policy runs here (`local`);
 *  - a model that runs in stages runs on several computers (`split`);
 *  - a thread set to answer on the network runs on one other computer (`remote`);
 *  - otherwise any route plaintext allows (`auto`), whose plan names the route and its readers before anything is sent.
 */
export function executionRouteFor({ privacy, model, executionLocation }) {
  if (privacy?.placement === 'local-only') return 'local';
  if (model?.partition) return 'split';
  if (model?.fleet) return 'auto';
  return executionLocation === 'network' ? 'remote' : 'auto';
}

/** The thread execution location a chosen route stands for. */
export const locationForRoute = route => route === 'local' ? 'local' : route === 'auto' ? 'auto' : 'network';
