import { isProductPath } from './shell-view.js';
const applyPoolNavOpenState = (nav, navToggle, isOpen) => {
  const openLabel = 'Close navigation';
  const closedLabel = 'Open navigation';
  nav.classList.toggle('is-open', isOpen);
  if (!isOpen) nav.querySelector('.pool-nav-more')?.removeAttribute('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
  navToggle.setAttribute('aria-label', isOpen ? openLabel : closedLabel);
  navToggle.setAttribute('title', isOpen ? openLabel : closedLabel);
  navToggle.dataset.poolNavTooltip = isOpen ? openLabel : closedLabel;
};

export const bindPoolRouteControls = (mount, render, {
  navOpen = false,
  onLeave = () => {},
  onNavOpenChange = () => {}
} = {}) => {
  const nav = mount.querySelector('.pool-nav-rail');
  const navToggle = mount.querySelector('.pool-nav-toggle');
  const navMenu = mount.querySelector('.pool-nav-menu');
  let setNavOpen = () => {};
  if (nav && navToggle && navMenu) {
    navMenu.hidden = false;
    setNavOpen = (isOpen) => {
      applyPoolNavOpenState(nav, navToggle, isOpen);
      onNavOpenChange(isOpen);
    };
    setNavOpen(navOpen);
    navToggle.addEventListener('click', () => {
      setNavOpen(!nav.classList.contains('is-open'));
    });
    nav.querySelector('.pool-nav-more-summary')?.addEventListener('click', () => {
      if (!nav.classList.contains('is-open')) setNavOpen(true);
    });
  }

  mount.querySelectorAll('[data-pool-route], [data-pool-route-link]').forEach((control) => {
    if (control.dataset.poolRouteBound === 'true') return;
    control.dataset.poolRouteBound = 'true';
    const path = control.dataset.poolRoute || control.dataset.poolRouteLink || control.getAttribute('href');
    const nextUrl = new URL(path, window.location.origin);
    if (nextUrl.origin !== window.location.origin || !isProductPath(nextUrl.pathname)) return;
    const resolvePath = () => {
      const destination = new URL(nextUrl);
      const currentUrl = new URL(window.location.href);
      for (const key of ['room', 'relay', 'swarm', 'swarmToken', 'signaling', 'instance']) {
        if (!destination.searchParams.has(key) && currentUrl.searchParams.has(key)) {
          destination.searchParams.set(key, currentUrl.searchParams.get(key));
        }
      }
      return `${destination.pathname}${destination.search}${destination.hash}`;
    };
    // Native new-tab navigation must retain the same context as an ordinary click.
    const refreshHref = () => { if (control.tagName === 'A') control.setAttribute('href', resolvePath()); };
    refreshHref();
    control.addEventListener('pointerdown', refreshHref);
    control.addEventListener('focus', refreshHref);
    control.addEventListener('click', (event) => {
      refreshHref();
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
        || control.hasAttribute('download') || (control.target && control.target !== '_self')) return;
      event.preventDefault();
      const nextPath = resolvePath();
      if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextPath) {
        window.history.pushState({ reploidPoolRoute: nextPath }, '', nextPath);
      }
      setNavOpen(false);
      render({ restoreNavigationFocus: true });
    });
  });

  mount.querySelectorAll('[data-pool-substrate-route]').forEach((control) => {
    control.addEventListener('click', () => {
      onLeave();
    });
  });
};
