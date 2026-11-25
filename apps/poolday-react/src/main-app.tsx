import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ProductApp } from './app/ProductApp';
import type { AppServices } from './app/services';
import { createAppearanceStore } from './features/shell/infrastructure/appearance';
import { adoptHost, openPageHost } from './features/shell/infrastructure/productHost';

// One product per page: mounting again (a fixture replacing the page's host) closes the previous one first.
let unmountCurrent: (() => void) | null = null;

function mount(root: HTMLElement, services: AppServices) {
  unmountCurrent?.();
  // The page root carries the Poolday tokens and page material, as the vanilla shell sets it.
  document.documentElement.classList.add('pool-page');
  root.replaceChildren();
  const react = createRoot(root);
  react.render(
    <StrictMode>
      <ProductApp services={services} />
    </StrictMode>,
  );
  const unmount = () => {
    if (unmountCurrent === unmount) unmountCurrent = null;
    react.unmount();
  };
  unmountCurrent = unmount;
  return unmount;
}

/**
 * The React Poolday product, with the vanilla shell's entry contract: mount into the page's root and
 * return a disposer. It opens this page's host.
 */
export function initPoolHome(root: HTMLElement, { signal }: { readonly signal?: AbortSignal } = {}) {
  signal?.throwIfAborted();
  return mount(root, { open: openPageHost, appearance: createAppearanceStore() });
}

/**
 * Mounts the product on a host the caller already opened: a fixture's host in the browser journeys,
 * or an embedding page's. The host keeps the shape apps/poolday/host/product-session.js returns;
 * parts it lacks are shown as unavailable.
 */
export function mountPoolday(
  root: HTMLElement,
  { host, earning = Promise.resolve(null), viewState }: { readonly host: object; readonly earning?: Promise<unknown>; readonly viewState?: object },
) {
  const opened = adoptHost(host as Parameters<typeof adoptHost>[0], earning);
  return mount(root, { open: async () => opened, appearance: createAppearanceStore(), ...(viewState ? { viewState } : {}) });
}

export default { initPoolHome, mountPoolday };
