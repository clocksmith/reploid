/**
 * The workspace's destinations: the conversation, the Threads drawer on the start side, and one of
 * Conversation details, Computers or Settings in the end drawer. The address bar records them
 * (`?view=`, and `threads=open` while both drawers are open), so Back and Forward move between them.
 */
export type WorkspaceView = 'chat' | 'threads' | 'conversation' | 'computers' | 'settings';
export type EndView = 'conversation' | 'computers' | 'settings';

export type WorkspaceLocation = {
  readonly view: WorkspaceView;
  /** The Threads drawer is open beside an end drawer. */
  readonly threads: boolean;
};

/**
 * The narrowest window in which both drawers lie beside the conversation's reading column without
 * covering it: two page gutters (2 x 16), the reading column (720 + 32) and room for the wider
 * drawer on each side (2 x (380 + 16)). Below it, opening one drawer closes the other.
 */
export const BOTH_DRAWERS_MIN_WIDTH = 1576;

const VIEWS: ReadonlySet<string> = new Set(['chat', 'threads', 'conversation', 'computers', 'settings']);
export const parseView = (value: string | null): WorkspaceView => (value && VIEWS.has(value) ? (value as WorkspaceView) : 'chat');

export const isEndView = (view: WorkspaceView): view is EndView => view === 'conversation' || view === 'computers' || view === 'settings';

/** Whether the Threads drawer shows at this location. */
export const threadsOpen = (location: WorkspaceLocation) => location.view === 'threads' || location.threads;

/** The end drawer that shows at this location, if any. */
export const endView = (location: WorkspaceLocation): EndView | null => (isEndView(location.view) ? location.view : null);

/** Where pressing a destination goes, from where the person is and how wide the window is. */
export function navigate(current: WorkspaceLocation, pressed: WorkspaceView, wide: boolean): WorkspaceLocation {
  const threads = threadsOpen(current);
  if (pressed === 'threads') {
    if (wide && isEndView(current.view)) return { view: current.view, threads: !threads };
    return { view: threads ? 'chat' : 'threads', threads: false };
  }
  // Pressing the open end destination again keeps it open, as the vanilla workspace did; its Close button closes it.
  if (pressed === current.view) return current;
  if (pressed === 'chat') return { view: 'chat', threads: false };
  return { view: pressed, threads: wide && threads };
}

/** A location restored from the address bar keeps both drawers only where both fit. */
export const restore = (location: WorkspaceLocation, wide: boolean): WorkspaceLocation =>
  !wide && location.threads && location.view !== 'threads' ? { view: location.view, threads: false } : location;

/** Closing one drawer leaves the other as it was. */
export function close(current: WorkspaceLocation, drawer: 'threads' | 'end'): WorkspaceLocation {
  if (drawer === 'threads') return isEndView(current.view) ? { view: current.view, threads: false } : { view: 'chat', threads: false };
  return { view: threadsOpen(current) ? 'threads' : 'chat', threads: false };
}
