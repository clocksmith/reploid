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

export function updateRouteAlternatives(node, offers) {
  if (!node) return;
  const signature = JSON.stringify(offers);
  if (node.dataset.offers === signature) return;
  node.dataset.offers = signature;
  node.hidden = offers.length === 0;
  const heading = node.ownerDocument.createElement('p');
  heading.className = 'pool-small pool-muted';
  heading.textContent = 'Your choice cannot answer right now. Other options:';
  const rows = offers.map(offer => {
    const button = node.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'pool-button btn-ghost pool-stack';
    button.dataset.routeAlternative = offer.key;
    const title = node.ownerDocument.createElement('span'), reads = node.ownerDocument.createElement('span');
    title.textContent = offer.title;
    reads.className = 'pool-caption pool-muted';
    reads.textContent = offer.reads;
    button.append(title, reads);
    return button;
  });
  node.replaceChildren(...(offers.length ? [heading, ...rows] : []));
}
