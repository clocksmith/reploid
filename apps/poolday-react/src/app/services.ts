import { useSyncExternalStore } from 'react';
import type { ResolvedTheme } from '../features/shell/domain/appearance';
import type { AppearanceStore } from '../features/shell/infrastructure/appearance';
import type { OpenedProduct } from '../features/shell/infrastructure/productHost';

/** What the page supplies to the product: how to open its host, and this browser's appearance. */
export type AppServices = {
  readonly open: (options: { readonly signal: AbortSignal }) => Promise<OpenedProduct>;
  readonly appearance: AppearanceStore;
  /** A conversation already staged (a fixture's chosen model); a page starts from its stored choice. */
  readonly viewState?: object;
};

export function useAppearance(store: AppearanceStore): ResolvedTheme {
  return useSyncExternalStore(store.subscribe, store.getTheme);
}
