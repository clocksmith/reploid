/**
 * What to offer when the chosen privacy tier cannot answer: only routes that exist now, each naming who could
 * read the request. A lower tier is an offer. Nothing changes until the person picks one, and picking one does
 * not send anything. With no route to offer, the composer's status says why and Send stays unavailable.
 */
import { modelExecutionState } from '../components/model-select.js';

export function routeAlternatives({ current, model, desktop = null, busy = false, closed = false, searching = false, fresh = false }) {
  // A custom list of computers has no single availability to judge, and a guest may use only its host.
  if (!model || busy || closed || searching || fresh || current === 'named' || desktop?.guest) return [];
  const local = modelExecutionState(model, 'local').usable, network = modelExecutionState(model, 'network').usable;
  const desktopOnline = desktop?.status === 'online';
  if (current === 'device' ? local : current === 'contributors' ? network : desktopOnline) return [];
  const offers = [];
  if (current !== 'device' && local) offers.push({ key: 'device', title: 'Run on this device', reads: 'Stays on this device.' });
  if (current !== 'desktop' && desktopOnline) {
    offers.push({ key: 'desktop', title: `Use ${desktop.label}`, reads: `The operator of ${desktop.label} can read this conversation.` });
  }
  if (current !== 'contributors' && network) {
    offers.push({ key: 'contributors', title: 'Use a public computer', reads: 'The operator of the computer that answers can read this conversation.' });
  }
  return offers;
}
