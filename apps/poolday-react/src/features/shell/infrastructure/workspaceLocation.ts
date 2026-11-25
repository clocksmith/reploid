// The workspace location in the address bar: `?view=` and `threads=open`, with history entries so
// Back and Forward move between destinations. The drawers' state is the URL's.
import * as ownerPairing from '../../../../../poolday/host/owner-pairing.js';
import { BOTH_DRAWERS_MIN_WIDTH, parseView, type WorkspaceLocation } from '../domain/navigation';

const { parseOwnerPairingUrl } = ownerPairing as unknown as { readonly parseOwnerPairingUrl: (href: string) => unknown };

export const isWide = () => (window.innerWidth || 0) >= BOTH_DRAWERS_MIN_WIDTH;

export function readLocation(): WorkspaceLocation {
  const params = new URL(window.location.href).searchParams;
  return { view: parseView(params.get('view')), threads: params.get('threads') === 'open' };
}

/** The address of a location, keeping the room and other parameters; a pairing link's hash is dropped. */
export function hrefFor(location: WorkspaceLocation): string {
  const url = new URL(window.location.href);
  if (!['/', '/network'].includes(url.pathname)) url.pathname = '/';
  if (parseOwnerPairingUrl(url.href)) url.hash = '';
  if (location.view === 'chat') url.searchParams.delete('view');
  else url.searchParams.set('view', location.view);
  if (location.threads && location.view !== 'chat' && location.view !== 'threads') url.searchParams.set('threads', 'open');
  else url.searchParams.delete('threads');
  return url.pathname + url.search + url.hash;
}

const current = () => window.location.pathname + window.location.search + window.location.hash;

/** Records a location as a new history entry; `replace` rewrites the current one. */
export function writeLocation(location: WorkspaceLocation, { replace = false } = {}) {
  const href = hrefFor(location);
  if (href === current()) return;
  if (replace) window.history.replaceState(window.history.state, '', href);
  else window.history.pushState(window.history.state, '', href);
}

/** Calls back on Back and Forward. */
export function subscribeLocation(listener: () => void): () => void {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
}

/** Calls back when the window crosses the width where both drawers fit. */
export function subscribeWidth(listener: (wide: boolean) => void): () => void {
  let wide = isWide();
  const onResize = () => {
    if (isWide() !== wide) {
      wide = isWide();
      listener(wide);
    }
  };
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}
