// Appearance: System, Light or Dark, stored for this browser as the vanilla shell stores it
// (reploid.appearance.v1). System follows the operating system and changes with it.
import { createProjectedStore } from '../../../../../poolday/host/decisions/projected-store.js';
import type { Appearance, ResolvedTheme } from '../domain/appearance';

const KEY = 'reploid.appearance.v1';
const CHOICES: ReadonlySet<string> = new Set(['system', 'light', 'dark']);

export type AppearanceStore = {
  readonly getChoice: () => Appearance;
  readonly getTheme: () => ResolvedTheme;
  readonly setChoice: (choice: Appearance) => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** Stops following the system scheme. */
  readonly dispose: () => void;
};

export function createAppearanceStore(storage: Storage | null = safeStorage()): AppearanceStore {
  const read = (): Appearance => {
    try {
      const value = storage?.getItem(KEY) ?? 'system';
      return CHOICES.has(value) ? (value as Appearance) : 'system';
    } catch {
      return 'system';
    }
  };
  let choice = read();
  const media = window.matchMedia?.('(prefers-color-scheme: light)');
  const resolve = (): ResolvedTheme => (choice !== 'system' ? choice : media && !media.matches ? 'dark' : 'light');
  let theme = resolve();
  // The system scheme is followed only while someone shows the theme; a new reader catches up on any change missed.
  const store = createProjectedStore({
    attach: () => {
      const onChange = () => {
        if (choice === 'system') publish();
      };
      media?.addEventListener?.('change', onChange);
      if (resolve() !== theme) queueMicrotask(publish);
      return () => media?.removeEventListener?.('change', onChange);
    },
    project: () => theme,
  });
  const publish = () => {
    theme = resolve();
    // The page root carries the theme too, for the page material outside the Poolday scope.
    document.documentElement.dataset.reploidTheme = theme;
    store.changed();
  };
  document.documentElement.dataset.reploidTheme = theme;
  return {
    getChoice: () => choice,
    getTheme: () => theme,
    setChoice(next) {
      choice = next;
      try {
        storage?.setItem(KEY, next);
      } catch {
        // Appearance persistence is optional.
      }
      publish();
    },
    subscribe: store.subscribe,
    dispose: store.dispose,
  };
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
