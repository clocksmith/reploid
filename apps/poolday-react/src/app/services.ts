import { useSyncExternalStore } from 'react';
import type { ResolvedTheme } from '../features/shell/domain/appearance';
import type { ProductRoute } from '../features/shell/domain/routes';
import type { AppearanceStore } from '../features/shell/infrastructure/appearance';
import type { OpenedProduct } from '../features/shell/infrastructure/productHost';

/** What the page supplies to the product: how to open its host, and this browser's appearance. */
export type AppServices = {
  readonly open: (options: { readonly signal: AbortSignal }) => Promise<OpenedProduct>;
  readonly appearance: AppearanceStore;
  /**
   * The host was opened by the caller and `open` hands back that same one every time. A mount that is
   * abandoned before it finished opening (React StrictMode mounts twice in development) must not close it:
   * the next mount is given the same host.
   */
  readonly adopted?: boolean;
  /** The route this page shows: the conversation workspace or one specialist page. */
  readonly route: ProductRoute;
  /** A conversation already staged (a fixture's chosen model); a page starts from its stored choice. */
  readonly viewState?: object;
};

export function useAppearance(store: AppearanceStore): ResolvedTheme {
  return useSyncExternalStore(store.subscribe, store.getTheme);
}
