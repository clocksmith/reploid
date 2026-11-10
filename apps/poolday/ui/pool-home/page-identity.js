/**
 * @fileoverview Per-page identity namespaces for requester and provider roles, scoped to how this
 * page was opened so reloads keep, and new tabs separate, their identities.
 */

export const pageIdentityNavigationType = (performanceRef = globalThis.performance) => {
  try {
    return performanceRef?.getEntriesByType?.('navigation')?.[0]?.type || null;
  } catch {
    return null;
  }
};

export const getPageIdentityNamespace = (globalKey, {
  windowRef = window,
  navigationType = pageIdentityNavigationType()
} = {}) => {
  if (windowRef[globalKey]) return windowRef[globalKey];
  const storageKey = `reploid.pool.page-identity.${globalKey}`;
  try {
    const stored = windowRef.sessionStorage?.getItem(storageKey);
    // sessionStorage is copied when a tab is duplicated or opened by an
    // opener. Restore only after a reload/history traversal so a copied tab
    // cannot impersonate the source tab's ephemeral role namespace.
    if (stored && (navigationType === 'reload' || navigationType === 'back_forward')) {
      windowRef[globalKey] = stored;
      return stored;
    }
  } catch {
    // A memory-only identity namespace remains valid for the current page.
  }
  const id = windowRef.crypto?.randomUUID
    ? windowRef.crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  windowRef[globalKey] = `page_${id}`;
  try {
    windowRef.sessionStorage?.setItem(storageKey, windowRef[globalKey]);
  } catch {
    // A memory-only identity namespace remains valid for the current page.
  }
  return windowRef[globalKey];
};

export const getProviderIdentityNamespace = () => getPageIdentityNamespace('REPLOID_POOL_PROVIDER_NAMESPACE');
export const getRequesterIdentityNamespace = () => getPageIdentityNamespace('REPLOID_POOL_REQUESTER_NAMESPACE');
